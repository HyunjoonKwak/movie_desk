import { getSegmenter } from "@/ai/bg-remove";
import { useLutStore } from "@/effects/lut/lut-store";
import { getEffect } from "@/effects/registry";
import { resolveMediaSource } from "@/media/source/resolve-media-source";
import {
  type AdjustmentClip,
  type BackdropBlendMode,
  type Clip,
  type EffectInstance,
  type ID,
  type MediaAsset,
  type MediaClip,
  type Project,
  type ShapeClip,
  type TextClip,
  type TransitionFrame,
  activeTransitionFor,
  clipTransform,
  isAdjustmentClip,
  isBackdropBlend,
  isMediaClip,
  isShapeClip,
  isTextClip,
  isWipe,
} from "@movie-desk/core";
import { sourceOffsetForRamp, textAnimAt, visibleAt } from "@movie-desk/core";
import { BoundedResourceCache } from "./bounded-resource-cache";
import { type ColorDomain, domainIndex, lutDomain } from "./color";
import {
  BACKDROP_BLEND_MODE,
  animateEffects,
  setBlendMode,
  setMaskUniforms,
  setTransformUniforms,
  setWipeUniforms,
} from "./compositor-uniforms";
import { FrameSourcePool } from "./frame-source";
import {
  type GL,
  type TargetFormat,
  allocateTarget,
  createGL,
  createQuad,
  createTexture,
  probeColorTarget,
  uploadSource,
} from "./gl";
import { type TransferProbe, probeVideoTransfer, uploadedVideoDomain } from "./input-color";
import { disposeLutTextures, uploadLutTexture } from "./lut-texture";
import { ManagedShaderContractError } from "./managed-shader";
import { PingPong } from "./ping-pong";
import { RetryBackoff } from "./retry-backoff";
import { ScratchPool } from "./scratch-pool";
import { type Program, ShaderRegistry } from "./shader-registry";
import { renderShapeToCanvas } from "./shape-source";
import { quarterTurns } from "./source-rotation";
import { renderTextToCanvas } from "./text-source";
import { getFrameProvider } from "./webcodecs-decoder";

// Per-clip ping-pong effect chain + final composite to the screen. Effect
// chain is data-driven by `effects/registry.ts`. Bg-remove receives a mask
// texture computed by MediaPipe; everything else just runs as fragment passes.
export class Compositor {
  private static readonly MAX_ASSET_TEXTURES = 24;
  private static readonly MAX_TEXT_TEXTURES = 64;
  private static readonly MAX_MASK_TEXTURES = 12;
  private readonly gl: GL;
  private readonly shaders: ShaderRegistry;
  private readonly quad: ReturnType<typeof createQuad>;
  private readonly assetTextures: BoundedResourceCache<string, WebGLTexture>;
  private readonly textTextures: BoundedResourceCache<string, WebGLTexture>;
  private readonly bgMaskTextures: BoundedResourceCache<string, WebGLTexture>;
  // asset.id -> source time (s) the cached mask was computed at. MediaPipe
  // segmentation is the single most expensive per-frame op, so we skip it when
  // the underlying source frame hasn't advanced (idle re-renders, edits while
  // paused). Videos re-segment as currentTime moves; still images (no
  // currentTime) segment once and stay cached.
  private readonly bgMaskTime = new Map<string, number>();
  private retainedAssetIds = new Set<string>();
  private readonly colorFormat: TargetFormat | null;
  private readonly colorPingPong: PingPong;
  private readonly colorScratch: ScratchPool;
  private managed = false;
  private invalidated = false;
  private readonly colorWarnings = new Set<string>();
  private readonly videoTransferProbe: TransferProbe;
  usesColorApproximation = false;
  private readonly sourceTargets = new BoundedResourceCache<
    string,
    ReturnType<typeof allocateTarget>
  >(8, (target) => {
    this.gl.deleteTexture(target.tex);
    this.gl.deleteFramebuffer(target.fbo);
  });
  private readonly imageTargets = new BoundedResourceCache<
    object,
    { target: ReturnType<typeof allocateTarget>; url: string }
  >(12, ({ target }) => {
    this.gl.deleteTexture(target.tex);
    this.gl.deleteFramebuffer(target.fbo);
  });
  private readonly normalizedSource = document.createElement("canvas");
  private readonly opaqueImages = new WeakMap<object, boolean>();
  private get pingPong() {
    return this.colorPingPong;
  }
  private get scratch() {
    return this.colorScratch;
  }
  private get sceneFbo() {
    return this.managed ? this.colorScratch.acquire(3).fbo : null;
  }
  get colorPrecision() {
    return this.colorFormat?.precision ?? "unsupported";
  }
  // Stable slot indices for the scratch pool. Slot 0 holds the captured
  // backdrop (adjustment layer + overlay/soft-light blend); slot 1 holds
  // the spatial-conform (fit) target. They never alias in a single iteration.
  private static readonly SCRATCH_BACKDROP = 0;
  private static readonly SCRATCH_FIT = 1;
  private static readonly SCRATCH_ROTATE = 2;
  readonly sources: FrameSourcePool;

  constructor(canvas: HTMLCanvasElement) {
    this.gl = createGL(canvas);
    this.assetTextures = new BoundedResourceCache(Compositor.MAX_ASSET_TEXTURES, (texture) =>
      this.gl.deleteTexture(texture),
    );
    this.textTextures = new BoundedResourceCache(Compositor.MAX_TEXT_TEXTURES, (texture) =>
      this.gl.deleteTexture(texture),
    );
    this.bgMaskTextures = new BoundedResourceCache(
      Compositor.MAX_MASK_TEXTURES,
      (texture, assetId) => {
        this.gl.deleteTexture(texture);
        this.bgMaskTime.delete(assetId);
      },
    );
    this.shaders = new ShaderRegistry(this.gl);
    this.quad = createQuad(this.gl);
    this.colorFormat = probeColorTarget(this.gl);
    this.videoTransferProbe = probeVideoTransfer(this.gl);
    this.colorPingPong = new PingPong(this.gl, this.colorFormat ?? undefined);
    this.colorScratch = new ScratchPool(this.gl, this.colorFormat ?? undefined);
    this.sources = new FrameSourcePool();
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  private playheadFn: () => number = () => 0;
  setPlayheadGetter(fn: () => number) {
    this.playheadFn = fn;
  }

  resize(cssWidth: number, cssHeight: number, dpr = Math.min(window.devicePixelRatio || 1, 2)) {
    const canvas = this.gl.canvas as HTMLCanvasElement;
    const w = Math.max(1, Math.round(cssWidth * dpr));
    const h = Math.max(1, Math.round(cssHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  invalidate() {
    this.invalidated = true;
  }

  async renderFrame(project: Project, getAsset: (id: ID) => MediaAsset | undefined) {
    const gl = this.gl;
    if (this.invalidated || gl.isContextLost()) return;
    const assetIds = new Set<string>(project.mediaLibrary.map((asset) => asset.id));
    this.retainedAssetIds = assetIds;
    this.assetTextures.retain(assetIds);
    this.bgMaskTextures.retain(assetIds);
    this.sources.retain(assetIds);
    const graphicClipIds = new Set<string>();
    for (const track of project.timeline.tracks) {
      for (const clip of track.clips) {
        if (isTextClip(clip) || isShapeClip(clip)) graphicClipIds.add(clip.id);
      }
    }
    this.textTextures.retain(graphicClipIds);
    this.decodeRetry.retain(assetIds);
    getFrameProvider().retain(
      new Set(
        project.mediaLibrary.filter((asset) => asset.kind === "video").map((asset) => asset.id),
      ),
    );
    const visible = visibleAt(project, project.timeline.playhead);
    this.managed = visible.length > 0 && !this.canBypass(visible, project, getAsset);
    if (this.managed && !this.colorFormat) {
      this.warnColor("unsupported");
      throw new Error("Linear color processing is unsupported on this GPU");
    }
    if (this.managed && this.colorFormat?.precision === "srgb8") this.warnColor("precision");
    if (this.managed) {
      try {
        this.colorPingPong.resize(gl.drawingBufferWidth, gl.drawingBufferHeight);
      } catch (error) {
        this.warnColor("unsupported");
        throw error;
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (visible.length === 0) return;
    const ordered = [...visible].reverse();

    for (const clip of ordered) {
      // Adjustment layers re-process the frame already drawn beneath them.
      if (isAdjustmentClip(clip)) {
        this.applyAdjustmentLayer(clip, project);
        continue;
      }
      // Text clips may animate (typewriter changes the rendered glyphs).
      const textAnim = isTextClip(clip)
        ? textAnimAt(clip, Math.max(0, project.timeline.playhead - clip.start))
        : null;
      let sourceTex = await this.uploadClip(clip, getAsset, project, textAnim?.charFrac ?? 1);
      if (this.invalidated || gl.isContextLost()) return;
      if (!sourceTex) continue;

      // Spatial conform: resample media into the frame aspect (fill/fit) so it
      // isn't stretched. Skipped for the default "stretch".
      if (isMediaClip(clip) && clip.fit && clip.fit !== "stretch") {
        const asset = getAsset(clip.assetId);
        if (asset?.width && asset?.height) {
          sourceTex = this.applyFit(sourceTex, asset.width / asset.height, clip.fit);
        }
      }

      let maskTexture: WebGLTexture | null = null;
      if (isMediaClip(clip) && clip.effects.some((e) => e.enabled && e.type === "bg-remove")) {
        const asset = getAsset(clip.assetId);
        if (asset) maskTexture = await this.uploadBgMask(asset);
        if (this.invalidated || gl.isContextLost()) return;
      }

      // Resolve keyframe-driven effect param overrides at the current clip
      // time so animations actually move. Targets are dotted paths into the
      // params, e.g. "effects.<id>.amount".
      const { effects: animatedEffects, kfValues } = animateEffects(clip, project);
      const finalTex = this.applyEffectChain(sourceTex, animatedEffects, maskTexture);

      // Final composite to screen with clip transform applied. Slides/fades
      // fold into the transform; wipes drive a GPU mask instead. Transform
      // keyframes (transform.x/y/scale/rotation/opacity) override the static
      // transform when present.
      // Text animations override the base transform (fade/slide/pop); other
      // clips use their static transform plus any keyframe overrides.
      const baseTf = textAnim ? textAnim.transform : clipTransform(clip);
      const tf = {
        x: kfValues["transform.x"] ?? baseTf.x,
        y: kfValues["transform.y"] ?? baseTf.y,
        scale: kfValues["transform.scale"] ?? baseTf.scale,
        rotation: kfValues["transform.rotation"] ?? baseTf.rotation,
        opacity: kfValues["transform.opacity"] ?? baseTf.opacity,
      };
      const transition = activeTransitionFor(clip, project.timeline.playhead);
      const wipe = transition && isWipe(transition.type) ? transition : null;
      const composed = wipe ? tf : applyTransitionToTransform(tf, transition);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      if (isBackdropBlend(clip.blendMode)) {
        this.compositeBackdropBlend(finalTex, composed, clip.mask, clip.blendMode, wipe);
      } else {
        setBlendMode(gl, clip.blendMode);
        const prog = this.shaders.get("blit", this.managed);
        prog.use();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, finalTex);
        gl.uniform1i(prog.uniform("u_tex"), 0);
        setTransformUniforms(gl, prog, composed);
        setWipeUniforms(gl, prog, wipe);
        setMaskUniforms(gl, prog, clip.mask);
        this.quad.draw();
      }
    }
    if (this.managed) {
      gl.disable(gl.BLEND);
      this.drawTransfer(this.colorScratch.acquire(3).tex, null, "linear", "srgb");
      gl.enable(gl.BLEND);
    }
    // Restore default premultiplied-over blending for the next frame.
    setBlendMode(gl, "normal");
  }

  // Composites a clip with one of the backdrop-reading blend modes by
  // capturing the backdrop and blending it in a shader (fixed-function GL
  // blending can't express these).
  private compositeBackdropBlend(
    finalTex: WebGLTexture,
    tf: { x: number; y: number; scale: number; rotation: number; opacity: number },
    mask: Clip["mask"],
    mode: BackdropBlendMode,
    wipe: TransitionFrame | null,
  ) {
    const gl = this.gl;
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const sceneFbo = this.sceneFbo;
    const backdrop = this.scratch.acquire(Compositor.SCRATCH_BACKDROP);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
    gl.bindTexture(gl.TEXTURE_2D, backdrop.tex);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, w, h);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
    gl.viewport(0, 0, w, h);
    setBlendMode(gl, "normal");
    const prog = this.shaders.get("blend-modes", this.managed);
    prog.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, finalTex);
    gl.uniform1i(prog.uniform("u_tex"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, backdrop.tex);
    gl.uniform1i(prog.uniform("u_backdrop"), 1);
    const resLoc = prog.uniform("u_resolution");
    if (resLoc) gl.uniform2f(resLoc, w, h);
    const modeLoc = prog.uniform("u_mode");
    if (modeLoc) gl.uniform1i(modeLoc, BACKDROP_BLEND_MODE[mode]);
    setTransformUniforms(gl, prog, tf);
    setWipeUniforms(gl, prog, wipe);
    setMaskUniforms(gl, prog, mask);
    this.quad.draw();
  }

  // Renders `src` into a frame-sized scratch slot, resampled to cover (fill)
  // or be contained (fit) at the source's aspect ratio instead of stretched.
  private applyFit(src: WebGLTexture, sourceAspect: number, mode: "fill" | "fit"): WebGLTexture {
    const gl = this.gl;
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const frameAspect = w / h;
    const slot = this.scratch.acquire(Compositor.SCRATCH_FIT);
    // UV scale: <1 crops (cover), >1 letterboxes (contain).
    let sx = 1;
    let sy = 1;
    if (mode === "fill") {
      if (sourceAspect > frameAspect) sx = frameAspect / sourceAspect;
      else sy = sourceAspect / frameAspect;
    } else {
      if (sourceAspect > frameAspect) sy = sourceAspect / frameAspect;
      else sx = frameAspect / sourceAspect;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, slot.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const prog = this.shaders.get("fit");
    prog.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.uniform1i(prog.uniform("u_tex"), 0);
    // Neutralise the shared vertex transform so we draw fullscreen.
    gl.uniform4f(prog.uniform("u_dest"), 0, 0, 1, 1);
    gl.uniform2f(prog.uniform("u_translate"), 0, 0);
    gl.uniform1f(prog.uniform("u_scale"), 1);
    gl.uniform1f(prog.uniform("u_rotation"), 0);
    gl.uniform2f(prog.uniform("u_uv_scale"), sx, sy);
    gl.disable(gl.BLEND);
    this.quad.draw();
    gl.enable(gl.BLEND);
    return slot.tex;
  }

  // Turns a decoded frame by the container's display rotation into a
  // frame-sized scratch slot. Only the WebCodecs path needs it.
  private applySourceRotation(src: WebGLTexture, rotation: MediaAsset["rotation"]): WebGLTexture {
    const turns = quarterTurns(rotation ?? 0);
    if (turns === 0) return src;
    const gl = this.gl;
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const slot = this.scratch.acquire(Compositor.SCRATCH_ROTATE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, slot.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const prog = this.shaders.get("rotate");
    prog.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.uniform1i(prog.uniform("u_tex"), 0);
    gl.uniform4f(prog.uniform("u_dest"), 0, 0, 1, 1);
    gl.uniform2f(prog.uniform("u_translate"), 0, 0);
    gl.uniform1f(prog.uniform("u_scale"), 1);
    gl.uniform1f(prog.uniform("u_rotation"), 0);
    gl.uniform1i(prog.uniform("u_turns"), turns);
    gl.disable(gl.BLEND);
    this.quad.draw();
    gl.enable(gl.BLEND);
    return slot.tex;
  }

  // Captures the frame drawn so far, runs the adjustment's effect chain over
  // it, then redraws the result with the clip's mask + opacity. No-op when the
  // adjustment has no enabled effects.
  private applyAdjustmentLayer(clip: AdjustmentClip, project: Project) {
    const gl = this.gl;
    if (!clip.effects.some((e) => e.enabled)) return;
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;

    const sceneFbo = this.sceneFbo;
    const backdrop = this.scratch.acquire(Compositor.SCRATCH_BACKDROP);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
    gl.bindTexture(gl.TEXTURE_2D, backdrop.tex);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, w, h);

    const { effects, kfValues } = animateEffects(clip, project);
    const resultTex = this.applyEffectChain(backdrop.tex, effects, null);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
    gl.viewport(0, 0, w, h);
    setBlendMode(gl, "normal");
    const prog = this.shaders.get("blit", this.managed);
    prog.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, resultTex);
    gl.uniform1i(prog.uniform("u_tex"), 0);
    const tf = clipTransform(clip);
    const opacity = kfValues["transform.opacity"] ?? tf.opacity;
    setTransformUniforms(gl, prog, { x: 0, y: 0, scale: 1, rotation: 0, opacity });
    setWipeUniforms(gl, prog, null);
    setMaskUniforms(gl, prog, clip.mask);
    this.quad.draw();
  }

  private canBypass(
    clips: readonly Clip[],
    project: Project,
    getAsset: (id: ID) => MediaAsset | undefined,
  ): boolean {
    if (clips.length !== 1) return false;
    const clip = clips[0]!;
    if (!isMediaClip(clip)) return false;
    const asset = getAsset(clip.assetId);
    const tf = clipTransform(clip);
    return (
      !!asset &&
      asset.width === this.gl.drawingBufferWidth &&
      asset.height === this.gl.drawingBufferHeight &&
      !asset.rotation &&
      (!clip.fit || clip.fit === "stretch") &&
      !clip.mask &&
      (!clip.blendMode || clip.blendMode === "normal") &&
      tf.x === 0 &&
      tf.y === 0 &&
      tf.scale === 1 &&
      tf.rotation === 0 &&
      tf.opacity === 1 &&
      Object.keys(animateEffects(clip, project).kfValues).length === 0 &&
      !activeTransitionFor(clip, project.timeline.playhead) &&
      !clip.effects.some((fx) => fx.enabled && (getEffect(fx.type)?.passes.length ?? 0) > 0)
    );
  }

  private drawTransfer(
    src: WebGLTexture,
    fbo: WebGLFramebuffer | null,
    from: ColorDomain,
    to: ColorDomain,
    w = this.gl.drawingBufferWidth,
    h = this.gl.drawingBufferHeight,
    straight = false,
  ) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    const prog = this.shaders.get("transfer");
    prog.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.uniform1i(prog.uniform("u_tex"), 0);
    gl.uniform1i(prog.uniform("u_straight"), straight ? 1 : 0);
    gl.uniform1i(prog.uniform("u_from"), domainIndex(from));
    gl.uniform1i(prog.uniform("u_to"), domainIndex(to));
    setTransformUniforms(gl, prog, { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 });
    this.quad.draw();
  }

  private warnColor(code: string, asset?: MediaAsset) {
    const key = `${code}:${asset?.id ?? "gpu"}`;
    if (this.colorWarnings.has(key)) return;
    this.colorWarnings.add(key);
    window.dispatchEvent(
      new CustomEvent("color-processing-warning", { detail: { code, name: asset?.name ?? "" } }),
    );
  }

  private sourceHasAlpha(source: TexImageSource): boolean {
    // Decoded YUV without an alpha plane is opaque. DOM video is handled by
    // the documented browser SDR fallback; immutable images are scanned once.
    if (source instanceof HTMLVideoElement) {
      if (typeof VideoFrame === "undefined") return true;
      try {
        const frame = new VideoFrame(source);
        const opaque = ["I420", "I422", "I444", "NV12", "RGBX", "BGRX"].includes(
          String(frame.format),
        );
        frame.close();
        return !opaque;
      } catch {
        return true;
      }
    }
    if (
      typeof VideoFrame !== "undefined" &&
      source instanceof VideoFrame &&
      ["I420", "I422", "I444", "NV12", "RGBX", "BGRX"].includes(String(source.format))
    )
      return false;
    const cached = this.opaqueImages.get(source);
    if (cached !== undefined) return !cached;
    const dimensions = source as {
      naturalWidth?: number;
      naturalHeight?: number;
      displayWidth?: number;
      displayHeight?: number;
      width: number;
      height: number;
    };
    const canvas = this.normalizedSource;
    canvas.width = dimensions.naturalWidth || dimensions.displayWidth || dimensions.width;
    canvas.height = dimensions.naturalHeight || dimensions.displayHeight || dimensions.height;
    const ctx = canvas.getContext("2d", { colorSpace: "srgb" });
    if (!ctx) return true;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source as CanvasImageSource, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let opaque = true;
    for (let i = 3; i < pixels.length; i += 4)
      if (pixels[i] !== 255) {
        opaque = false;
        break;
      }
    if (
      source instanceof HTMLImageElement ||
      (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap)
    )
      this.opaqueImages.set(source, opaque);
    return !opaque;
  }

  private uploadVisualSource(
    tex: WebGLTexture,
    source: TexImageSource,
    asset?: MediaAsset,
  ): WebGLTexture {
    const videoFrame =
      typeof VideoFrame !== "undefined" && source instanceof VideoFrame ? source : null;
    const interpretation = videoFrame
      ? uploadedVideoDomain(videoFrame.colorSpace.toJSON(), this.videoTransferProbe)
      : { domain: "srgb" as const, approximate: source instanceof HTMLVideoElement };
    if (interpretation.approximate) {
      this.usesColorApproximation = true;
      this.warnColor("approximation", asset);
    }
    if (
      typeof VideoFrame !== "undefined" &&
      source instanceof VideoFrame &&
      ["pq", "hlg", "smpte2084", "arib-std-b67"].includes(String(source.colorSpace.transfer))
    )
      this.warnColor("hdr", asset);
    if (!this.managed && this.sourceHasAlpha(source)) {
      this.managed = true;
      if (!this.colorFormat) {
        this.warnColor("unsupported");
        throw new Error("Linear alpha compositing is unsupported");
      }
      if (this.colorFormat.precision === "srgb8") this.warnColor("precision");
      const gl = this.gl;
      this.colorPingPong.resize(gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    if (!this.managed) return uploadSource(this.gl, tex, source);
    const immutableImage =
      source instanceof HTMLImageElement ||
      (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap)
        ? source
        : null;
    const imageUrl = source instanceof HTMLImageElement ? source.currentSrc : "";
    const cachedImage = immutableImage ? this.imageTargets.get(immutableImage) : undefined;
    if (cachedImage?.url === imageUrl) return cachedImage.target.tex;
    // Images use the browser's sRGB image/profile conversion. VideoFrames use
    // the measured upload transfer directly. DOM video is explicitly approximate:
    // an sRGB Canvas2D target alone does not prove BT.709 transfer normalization.
    const dimensions = source as {
      videoWidth?: number;
      videoHeight?: number;
      displayWidth?: number;
      displayHeight?: number;
      width: number;
      height: number;
      naturalWidth?: number;
      naturalHeight?: number;
    };
    const w =
      dimensions.videoWidth ||
      dimensions.displayWidth ||
      dimensions.naturalWidth ||
      dimensions.width;
    const h =
      dimensions.videoHeight ||
      dimensions.displayHeight ||
      dimensions.naturalHeight ||
      dimensions.height;
    const canvas = this.normalizedSource;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d", { colorSpace: "srgb" });
    if (!ctx) throw new Error("sRGB source normalization is unavailable");
    const sourceCanvas = source instanceof HTMLCanvasElement ? source : null;
    const alreadySrgb =
      sourceCanvas?.getContext("2d")?.getContextAttributes().colorSpace === "srgb";
    const directSource = alreadySrgb || videoFrame || source instanceof HTMLVideoElement;
    if (!directSource) {
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(source as CanvasImageSource, 0, 0);
    }
    uploadSource(this.gl, tex, directSource ? source : canvas, false);
    const gl = this.gl;
    const key = `${w}x${h}`;
    let target = immutableImage ? undefined : this.sourceTargets.get(key);
    if (!target) {
      target = allocateTarget(gl, w, h, this.colorFormat!);
      if (immutableImage) this.imageTargets.set(immutableImage, { target, url: imageUrl });
      else this.sourceTargets.set(key, target);
    }
    gl.disable(gl.BLEND);
    this.drawTransfer(tex, target.fbo, interpretation.domain, "linear", w, h, true);
    gl.enable(gl.BLEND);
    return target.tex;
  }

  private async uploadClip(
    clip: Clip,
    getAsset: (id: ID) => MediaAsset | undefined,
    project: Project,
    charFrac = 1,
  ): Promise<WebGLTexture | null> {
    if (isMediaClip(clip)) {
      const asset = getAsset(clip.assetId);
      if (!asset) return null;
      return this.uploadClipSource(clip, asset);
    }
    if (isTextClip(clip)) return this.uploadTextClip(clip, project, charFrac);
    if (isShapeClip(clip)) return this.uploadShapeClip(clip, project);
    return null;
  }

  private uploadTextClip(clip: TextClip, project: Project, charFrac = 1): WebGLTexture {
    const w = project.resolution.w;
    const h = project.resolution.h;
    const canvas = renderTextToCanvas(clip, w, h, charFrac);
    let tex = this.textTextures.get(clip.id);
    if (!tex) {
      tex = createTexture(this.gl);
      this.textTextures.set(clip.id, tex);
    }
    return this.uploadVisualSource(tex, canvas);
  }

  private uploadShapeClip(clip: ShapeClip, project: Project): WebGLTexture {
    const w = project.resolution.w;
    const h = project.resolution.h;
    const canvas = renderShapeToCanvas(clip, w, h);
    let tex = this.textTextures.get(clip.id);
    if (!tex) {
      tex = createTexture(this.gl);
      this.textTextures.set(clip.id, tex);
    }
    return this.uploadVisualSource(tex, canvas);
  }

  private applyEffectChain(
    input: WebGLTexture,
    effects: readonly EffectInstance[],
    maskTexture: WebGLTexture | null = null,
  ): WebGLTexture {
    const gl = this.gl;
    const enabled = effects.filter((e) => e.enabled);
    if (enabled.length === 0) return input;
    const { w, h } = this.pingPong.size();
    let current = input;
    let domain: ColorDomain = "linear";
    gl.disable(gl.BLEND);

    for (const fx of enabled) {
      const def = getEffect(fx.type);
      if (!def) continue;
      let lutBinding: ReturnType<typeof uploadLutTexture> | null = null;
      if (fx.type === "lut") {
        const lutId = String(fx.params.lutId ?? "");
        const stored = lutId ? useLutStore.getState().getLut(lutId) : undefined;
        if (!stored) continue;
        try {
          lutBinding = uploadLutTexture(gl, lutId, stored.raw);
        } catch {
          // An invalid/deleted LUT makes this effect a no-op instead of
          // sampling an unbound texture and corrupting the rendered frame.
          continue;
        }
      }
      if (def.passes.length === 0) continue;
      let nextDomain: ColorDomain;
      try {
        nextDomain =
          fx.type === "lut"
            ? lutDomain(fx.params.colorSpace)
            : def.workingSpace === "encoded"
              ? "srgb"
              : "linear";
      } catch (error) {
        this.warnColor("lutUnsupported");
        throw error;
      }
      if (this.managed && nextDomain !== domain) {
        const [, dst] = this.pingPong.current();
        this.drawTransfer(current, dst.fbo, domain, nextDomain);
        current = dst.tex;
        this.pingPong.swap();
        domain = nextDomain;
      }
      for (const pass of def.passes) {
        const [, dst] = this.pingPong.current();
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
        gl.viewport(0, 0, w, h);
        let prog: ReturnType<ShaderRegistry["get"]>;
        try {
          prog = this.shaders.get(pass.shader, this.managed);
        } catch (error) {
          if (error instanceof ManagedShaderContractError) throw error;
          // A shader that failed to compile/link (or is missing)
          // degrades this one effect to a no-op instead of throwing out of the
          // whole chain and dropping the entire composited frame — mirrors the
          // LUT guard above.
          break;
        }
        prog.use();

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, current);
        gl.uniform1i(prog.uniform("u_tex"), 0);
        gl.uniform1f(prog.uniform("u_opacity"), 1);
        gl.uniform4f(prog.uniform("u_dest"), 0, 0, 1, 1);
        // Effect passes always draw fullscreen — neutralise any transform
        // uniforms that the shared vertex shader might still consume.
        const translate = prog.uniform("u_translate");
        if (translate) gl.uniform2f(translate, 0, 0);
        const scaleLoc = prog.uniform("u_scale");
        if (scaleLoc) gl.uniform1f(scaleLoc, 1);
        const rotLoc = prog.uniform("u_rotation");
        if (rotLoc) gl.uniform1f(rotLoc, 0);
        const aspectLoc = prog.uniform("u_aspect");
        if (aspectLoc) gl.uniform1f(aspectLoc, 1);
        const texel = prog.uniform("u_texel");
        if (texel) gl.uniform2f(texel, 1 / w, 1 / h);
        // Disable any wipe mask the shared blit shader might consume.
        const wipeModeLoc = prog.uniform("u_wipe_mode");
        if (wipeModeLoc) gl.uniform1i(wipeModeLoc, 0);
        const maskShapeLoc = prog.uniform("u_mask_shape");
        if (maskShapeLoc) gl.uniform1i(maskShapeLoc, 0);

        const maskLoc = prog.uniform("u_mask");
        const hasMaskLoc = prog.uniform("u_has_mask");
        if (maskLoc) {
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, maskTexture ?? current);
          gl.uniform1i(maskLoc, 1);
          if (hasMaskLoc) gl.uniform1i(hasMaskLoc, maskTexture ? 1 : 0);
        }

        // LUT binding — only for the lut shader when a stored LUT is selected.
        if (lutBinding) {
          const { tex, size, dimension, domainMin, domainMax } = lutBinding;
          gl.activeTexture(gl.TEXTURE2);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          const lutLoc = prog.uniform("u_lut");
          const sizeLoc = prog.uniform("u_lut_size");
          const dimensionLoc = prog.uniform("u_lut_dimension");
          const domainMinLoc = prog.uniform("u_lut_domain_min");
          const domainMaxLoc = prog.uniform("u_lut_domain_max");
          if (lutLoc) gl.uniform1i(lutLoc, 2);
          if (sizeLoc) gl.uniform1f(sizeLoc, size);
          if (dimensionLoc) gl.uniform1i(dimensionLoc, dimension);
          if (domainMinLoc) gl.uniform3f(domainMinLoc, ...domainMin);
          if (domainMaxLoc) gl.uniform3f(domainMaxLoc, ...domainMax);
        }

        const uniforms = pass.uniforms({ params: fx.params, width: w, height: h });
        for (const [name, value] of Object.entries(uniforms)) {
          const loc = prog.uniform(name);
          if (!loc) continue;
          if (Array.isArray(value)) {
            if (value.length === 2) gl.uniform2f(loc, value[0]!, value[1]!);
            else if (value.length === 3) gl.uniform3f(loc, value[0]!, value[1]!, value[2]!);
            else if (value.length === 4)
              gl.uniform4f(loc, value[0]!, value[1]!, value[2]!, value[3]!);
          } else if (typeof value === "number") {
            gl.uniform1f(loc, value);
          }
        }
        this.quad.draw();
        current = dst.tex;
        this.pingPong.swap();
      }
    }
    if (this.managed && domain !== "linear") {
      const [, dst] = this.pingPong.current();
      this.drawTransfer(current, dst.fbo, domain, "linear");
      current = dst.tex;
      this.pingPong.swap();
    }
    gl.enable(gl.BLEND);
    return current;
  }

  private readonly decodePreparing = new Set<string>();
  // Missing or unreadable sources retry with a growing delay (1 s → 30 s);
  // a changed asset record (relink, rebuilt proxy) retries at once.
  private readonly decodeRetry = new RetryBackoff();

  private async uploadClipSource(clip: MediaClip, asset: MediaAsset): Promise<WebGLTexture | null> {
    // Map timeline time → source time. A frozen clip always shows one source
    // frame; otherwise this is the speed-ramp integral (or constant-speed).
    const clipRel = this.playheadFn() - clip.start;
    const relativeMs =
      clip.freeze !== undefined
        ? clip.freeze
        : (clip.trimIn ?? 0) + sourceOffsetForRamp(clip, Math.max(0, clipRel));

    // WebCodecs fast path: if we have a decoded frame near this timestamp,
    // upload it instead of seeking the <video>.
    if (asset.kind === "video") {
      const provider = getFrameProvider();
      // Prepare the decoder asynchronously; the provider says whether it
      // still holds one (it evicts the least recently used handles).
      if (
        !provider.has(asset.id) &&
        !this.decodePreparing.has(asset.id) &&
        this.decodeRetry.shouldTry(asset.id, asset)
      ) {
        this.decodePreparing.add(asset.id);
        void (async () => {
          try {
            // Offline/missing sources resolve to null and retry later with
            // backoff, like a missing OPFS copy did before D1.
            const source = await resolveMediaSource(asset).catch(() => null);
            if (source && (await provider.prepare(asset.id, source))) {
              if (this.retainedAssetIds.has(asset.id)) {
                this.decodeRetry.succeed(asset.id);
              } else {
                provider.forget(asset.id);
              }
            } else {
              this.decodeRetry.fail(asset.id, asset);
            }
          } finally {
            this.decodePreparing.delete(asset.id);
          }
        })();
      }
      const frame = provider.framesFor(asset.id, Math.max(0, relativeMs));
      if (frame) {
        let tex = this.assetTextures.get(asset.id);
        if (!tex) {
          tex = createTexture(this.gl);
          this.assetTextures.set(asset.id, tex);
        }
        tex = this.uploadVisualSource(tex, frame, asset);
        // WebCodecs frames come back unrotated; the media element path below
        // already honours the container's display matrix.
        return asset.rotation ? this.applySourceRotation(tex, asset.rotation) : tex;
      }
    }

    // Fallback: <video> / <img> element seek.
    const source = await this.sources.get(asset);
    if (!source) return null;
    if (source instanceof HTMLVideoElement) {
      const targetSec = Math.max(0, relativeMs / 1000);
      if (Math.abs(source.currentTime - targetSec) > 0.04) {
        source.currentTime = targetSec;
        await new Promise<void>((resolve) => {
          const onSeeked = () => {
            source.removeEventListener("seeked", onSeeked);
            resolve();
          };
          source.addEventListener("seeked", onSeeked);
        });
      }
    }
    let tex = this.assetTextures.get(asset.id);
    if (!tex) {
      tex = createTexture(this.gl);
      this.assetTextures.set(asset.id, tex);
    }
    return this.uploadVisualSource(tex, source, asset);
  }

  private async uploadBgMask(asset: MediaAsset): Promise<WebGLTexture | null> {
    const source = await this.sources.get(asset);
    if (!source) return null;

    // Reuse the last mask when the source frame hasn't moved. `currentTime`
    // is stable across idle re-renders of a paused clip and identical for
    // still images (which lack it, so they key on 0).
    const srcTime = "currentTime" in source ? source.currentTime : 0;
    const cached = this.bgMaskTextures.get(asset.id);
    if (cached && this.bgMaskTime.get(asset.id) === srcTime) return cached;

    try {
      const segmenter = await getSegmenter();
      const mask = await segmenter.segmentFor(source);
      if (!mask) return null;
      let tex = cached;
      if (!tex) {
        tex = createTexture(this.gl);
        this.bgMaskTextures.set(asset.id, tex);
      }
      uploadSource(this.gl, tex, mask);
      this.bgMaskTime.set(asset.id, srcTime);
      return tex;
    } catch (err) {
      // biome-ignore lint/suspicious/noConsole: MediaPipe failures otherwise disappear silently.
      console.warn("bg-remove mask failed:", err);
      return null;
    }
  }

  // (helper kept outside the class for testability)
  // ----

  dispose() {
    this.invalidate();
    this.assetTextures.clear();
    this.textTextures.clear();
    this.bgMaskTextures.clear();
    this.bgMaskTime.clear();
    this.decodePreparing.clear();
    this.decodeRetry.clear();
    this.retainedAssetIds.clear();
    disposeLutTextures(this.gl);
    this.colorScratch.dispose();
    this.sourceTargets.clear();
    this.imageTargets.clear();
    this.shaders.dispose();
    this.colorPingPong.dispose();
    this.sources.dispose();
  }
}

// Fold the transition's effect into the clip transform we hand to GL.
// `progress` is 1 when the clip is fully opaque and 0 when fully gone.
function applyTransitionToTransform(
  tf: { x: number; y: number; scale: number; rotation: number; opacity: number },
  transition: TransitionFrame | null,
): typeof tf {
  if (!transition) return tf;
  const p = transition.progress;
  switch (transition.type) {
    case "fade":
    case "cross-dissolve":
    case "dip-to-black":
    case "dip-to-white": {
      return { ...tf, opacity: tf.opacity * p };
    }
    case "slide-left":
      return { ...tf, x: tf.x + (1 - p), opacity: tf.opacity * Math.min(1, p * 1.2) };
    case "slide-right":
      return { ...tf, x: tf.x - (1 - p), opacity: tf.opacity * Math.min(1, p * 1.2) };
    case "slide-up":
      return { ...tf, y: tf.y + (1 - p), opacity: tf.opacity * Math.min(1, p * 1.2) };
    case "slide-down":
      return { ...tf, y: tf.y - (1 - p), opacity: tf.opacity * Math.min(1, p * 1.2) };
    case "zoom-in":
      // Grows from small to full while fading in.
      return { ...tf, scale: tf.scale * (0.5 + 0.5 * p), opacity: tf.opacity * p };
    case "zoom-out":
      // Shrinks from oversized to full while fading in.
      return { ...tf, scale: tf.scale * (1.5 - 0.5 * p), opacity: tf.opacity * p };
    case "spin":
      // Rotates into place (half turn) while fading in.
      return { ...tf, rotation: tf.rotation + (1 - p) * Math.PI, opacity: tf.opacity * p };
    default:
      // Wipe variants are handled by the GPU mask path, never reaching here.
      // Any unknown type falls back to a plain fade.
      return { ...tf, opacity: tf.opacity * p };
  }
}

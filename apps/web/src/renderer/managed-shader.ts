// Artistic operations receive straight RGB in the declared domain, then return
// premultiplied pixels. Spatial filters operate on premultiplied RGB and coverage.
export class ManagedShaderContractError extends Error {}

export const replaceOnce = (source: string, needle: string, replacement: string): string => {
  const at = source.indexOf(needle);
  if (at < 0 || source.indexOf(needle, at + needle.length) >= 0)
    throw new ManagedShaderContractError(
      `Managed shader expected exactly one occurrence: ${needle}`,
    );
  return source.replace(needle, replacement);
};

export const managedShader = (name: string, source: string): string => {
  let fs = ["transfer", "blend-modes"].includes(name)
    ? replaceOnce(source, "precision highp float;", "precision highp float;")
    : replaceOnce(source, "precision mediump float;", "precision highp float;");
  const replace = (needle: string, replacement: string) => {
    fs = replaceOnce(fs, needle, replacement);
  };
  if (name === "blit") {
    replace("vec4(c.rgb, c.a * u_opacity * wm * vm)", "c * (u_opacity * wm * vm)");
    return fs;
  }
  if (name === "gaussian-blur") {
    replace("vec3 acc = vec3(0.0);", "vec4 acc = vec4(0.0);");
    replace("texture(u_tex, v_uv + offset).rgb", "texture(u_tex, v_uv + offset)");
    replace("vec4(acc / total, texture(u_tex, v_uv).a)", "acc / total");
    return fs;
  }
  if (name === "sharpen") {
    replace(
      "vec3 sharp = c.rgb * (1.0 + 4.0 * u_amount) - (n.rgb + s.rgb + e.rgb + w.rgb) * u_amount;",
      "vec4 sharp = c * (1.0 + 4.0 * u_amount) - (n + s + e + w) * u_amount;",
    );
    // Limit coverage, preserve straight HDR color when coverage overshoots,
    // and enforce zero RGB when the sharpened coverage is zero/negative.
    replace(
      "vec4(clamp(sharp, 0.0, 1.0), c.a)",
      "vec4(sharp.a > 0.0 ? max(sharp.rgb, 0.0) * (clamp(sharp.a, 0.0, 1.0) / sharp.a) : vec3(0.0), clamp(sharp.a, 0.0, 1.0))",
    );
    return fs;
  }
  if (name === "bg-remove") {
    replace("vec4(c.rgb, c.a * a)", "c * a");
    return fs;
  }
  // Explicit linear artistic blend contract; see compositor-uniforms and audit.
  if (name === "blend-modes") {
    replace("clamp(fg.rgb / fg.a, 0.0, 1.0)", "fg.rgb / fg.a");
    replace("clamp(blendFor(bd, fgc), 0.0, 1.0)", "blendFor(bd, fgc)");
    replace("sqrt(b)", "sqrt(max(b, 0.0))");
    return fs;
  }
  if (["fit", "rotate", "transfer"].includes(name)) return fs;
  if (name === "exposure")
    replace("clamp(c.rgb * pow(2.0, u_stops), 0.0, 1.0)", "c.rgb * exp2(u_stops)");
  if (name === "white-balance") replace("clamp(rgb, 0.0, 1.0)", "rgb");
  if (name === "color-wheels") {
    replace("pow(clamp(col, 0.0, 1.0), g)", "pow(max(col, 0.0), g)");
    replace("vec4(clamp(col, 0.0, 1.0), c.a)", "vec4(max(col, 0.0), c.a)");
  }
  if (name === "grain") replace("clamp(c.rgb + n, 0.0, 1.0)", "c.rgb + n");
  if (!fs.includes("texture(u_tex,"))
    throw new ManagedShaderContractError(`Managed shader has no source sample: ${name}`);
  fs = fs.replaceAll("texture(u_tex,", "straightSample(u_tex,");
  fs = replaceOnce(
    fs,
    "void main()",
    `vec4 straightSample(sampler2D tex, vec2 uv) {
    vec4 c = texture(tex, uv);
    return vec4(c.a > 0.0 ? c.rgb / c.a : vec3(0.0), c.a);
  }
  void effectMain()`,
  );
  return `${fs}\nvoid main() { effectMain(); fragColor.rgb *= fragColor.a; }\n`;
};

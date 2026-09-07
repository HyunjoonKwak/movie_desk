// Artistic operations receive straight RGB in the declared domain, then return
// premultiplied pixels. Spatial filters operate on premultiplied RGB and coverage.
export const managedShader = (name: string, source: string): string => {
  let fs = source.replace("precision mediump float;", "precision highp float;");
  if (name === "blit")
    return fs.replace("vec4(c.rgb, c.a * u_opacity * wm * vm)", "c * (u_opacity * wm * vm)");
  if (name === "gaussian-blur")
    return fs
      .replace("vec3 acc = vec3(0.0);", "vec4 acc = vec4(0.0);")
      .replace("texture(u_tex, v_uv + offset).rgb", "texture(u_tex, v_uv + offset)")
      .replace("vec4(acc / total, texture(u_tex, v_uv).a)", "acc / total");
  if (name === "sharpen") return fs.replace("clamp(sharp, 0.0, 1.0)", "sharp");
  if (name === "bg-remove") return fs.replace("vec4(c.rgb, c.a * a)", "c * a");
  if (name === "blend-modes")
    return fs
      .replace("clamp(fg.rgb / fg.a, 0.0, 1.0)", "fg.rgb / fg.a")
      .replace("clamp(blendFor(bd, fgc), 0.0, 1.0)", "blendFor(bd, fgc)")
      .replace("sqrt(b)", "sqrt(max(b, 0.0))");
  if (["fit", "rotate", "transfer"].includes(name)) return fs;
  if (name === "exposure")
    fs = fs.replace("clamp(c.rgb * pow(2.0, u_stops), 0.0, 1.0)", "c.rgb * exp2(u_stops)");
  if (name === "white-balance") fs = fs.replace("clamp(rgb, 0.0, 1.0)", "rgb");
  if (name === "color-wheels") fs = fs.replaceAll("clamp(col, 0.0, 1.0)", "max(col, 0.0)");
  if (name === "grain") fs = fs.replace("clamp(c.rgb + n, 0.0, 1.0)", "c.rgb + n");
  fs = fs.replaceAll("texture(u_tex,", "straightSample(u_tex,");
  fs = fs.replace(
    "void main()",
    `vec4 straightSample(sampler2D tex, vec2 uv) {
    vec4 c = texture(tex, uv);
    return vec4(c.a > 0.0 ? c.rgb / c.a : vec3(0.0), c.a);
  }
  void effectMain()`,
  );
  return `${fs}\nvoid main() { effectMain(); fragColor.rgb *= fragColor.a; }\n`;
};

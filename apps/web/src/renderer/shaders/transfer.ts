import { TRANSFER_GLSL } from "../color";
export const fs = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform int u_from;
uniform int u_to;
uniform int u_straight;
out vec4 fragColor;
${TRANSFER_GLSL}
void main() {
  vec4 c = texture(u_tex, v_uv);
  vec3 straight = u_straight == 1 ? c.rgb : (c.a > 0.0 ? c.rgb / c.a : vec3(0.0));
  fragColor = vec4(encodeColor(decodeColor(straight, u_from), u_to) * c.a, c.a);
}
`;

// Turns a decoded frame by whole quarter turns (clockwise, u_turns 1..3) into
// a frame-sized target. Textures are uploaded with UNPACK_FLIP_Y, so the
// mapping runs in image space (v down) and flips back for sampling.
export const fs = /* glsl */ `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform int u_turns;
out vec4 fragColor;
void main() {
  vec2 img = vec2(v_uv.x, 1.0 - v_uv.y);
  vec2 src;
  if (u_turns == 1) src = vec2(img.y, 1.0 - img.x);
  else if (u_turns == 2) src = vec2(1.0 - img.x, 1.0 - img.y);
  else if (u_turns == 3) src = vec2(1.0 - img.y, img.x);
  else src = img;
  fragColor = texture(u_tex, vec2(src.x, 1.0 - src.y));
}
`;

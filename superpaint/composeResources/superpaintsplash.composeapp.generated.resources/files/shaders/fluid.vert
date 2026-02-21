#version 300 es
precision highp float;

out vec2 uv;

uniform mat4 u_uv_xform;

void main() {
    float x = float((gl_VertexID & 1) << 2) - 1.0;
    float y = float((gl_VertexID & 2) << 1) - 1.0;
    vec2 pos = vec2(x, y);
    vec2 baseUV = pos * 0.5 + 0.5;
    uv = (u_uv_xform * vec4(baseUV, 0.0, 1.0)).xy;
    gl_Position = vec4(pos, 0.0, 1.0);
}
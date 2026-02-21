#version 300 es
precision highp float;

uniform sampler2D u_tex_0;
uniform sampler2D u_tex_1;
uniform sampler2D u_tex_2;
uniform sampler2D u_tex_3;
uniform vec2 u_pixel;
uniform float u_dt;
uniform float u_rand;
uniform int u_pass;
uniform vec2 u_gravity;
uniform float u_viscosity;
uniform float u_dry_blend;
uniform float u_fade_strength;
uniform float u_blur_strength;
uniform float u_spray;
uniform float u_splat_radius;
uniform vec2 u_splat_start;
uniform vec2 u_splat_end;
uniform vec2 u_splat_start2;
uniform vec2 u_splat_end2;
uniform vec4 u_splat_color;
uniform vec2 u_splat_velocity;
uniform vec3 u_background_color;

in vec2 uv;
layout(location = 0) out vec4 out_color_0;
layout(location = 1) out vec4 out_color_1;
layout(location = 2) out vec4 out_color_2;

#define EPSILON 0.001

float hash12(vec2 p) {
    vec3 p3  = fract(vec3(p.xyx) * .1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

vec4 hash42(vec2 p) {
    vec4 p4 = fract(vec4(p.xyxy) * vec4(.1031, .1030, .0973, .1099));
    p4 += dot(p4, p4.wzxy + 33.33);
    return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}

// Squared distance to triangle (0 if inside)
float udTriangleSq(vec2 p, vec2 a, vec2 b, vec2 c) {
    vec3 vx = vec3(b.x - a.x, c.x - b.x, a.x - c.x);
    vec3 vy = vec3(b.y - a.y, c.y - b.y, a.y - c.y);
    vec3 px = p.x - vec3(a.x, b.x, c.x);
    vec3 py = p.y - vec3(a.y, b.y, c.y);
    vec3 t = clamp((vx * px + vy * py) / max(vx * vx + vy * vy, EPSILON), 0.0, 1.0);
    vec3 dx = px - vx * t;
    vec3 dy = py - vy * t;
    vec3 d2 = dx * dx + dy * dy;
    vec3 C = vx * py - vy * px;
    vec3 s = step(0.0, C);
    float inside = max(s.x * s.y * s.z, (1.0 - s.x) * (1.0 - s.y) * (1.0 - s.z));
    inside *= step(EPSILON, abs(vx.x * vy.y - vy.x * vx.y)); // 0 area handling
    return min(d2.x, min(d2.y, d2.z)) * (1.0 - inside);
}

float calcSplatStrength(vec2 p, vec2 p1, vec2 p2, vec2 c1, vec2 c2, float r) {
    float distSq = min(udTriangleSq(p, p1, p2, c1), udTriangleSq(p, p2, c2, c1));
    float rSq = max(r * r, EPSILON);
    float falloff = 1.0 - smoothstep(0.5, 1.0, distSq / rSq);
    float radiusTest = step(EPSILON, r);
    float sprayTest = step(u_spray, hash12(p + u_rand * 50.0));
    return radiusTest * sprayTest * falloff;
}

void main() {
    ivec2 P = ivec2(gl_FragCoord.xy);

    switch (u_pass) {
        // Divergence
        case 0: {
            float L = texelFetch(u_tex_0, P - ivec2(1, 0), 0).x;
            float R = texelFetch(u_tex_0, P + ivec2(1, 0), 0).x;
            float B = texelFetch(u_tex_0, P - ivec2(0, 1), 0).y;
            float T = texelFetch(u_tex_0, P + ivec2(0, 1), 0).y;
            float div = 0.5 * ((R - L) + (T - B));
            out_color_0 = vec4(div, 0.0, 0.0, 1.0);
            break;
        }

        // Pressure Solve
        case 1: {
            float L = texelFetch(u_tex_0, P - ivec2(1, 0), 0).x;
            float R = texelFetch(u_tex_0, P + ivec2(1, 0), 0).x;
            float B = texelFetch(u_tex_0, P - ivec2(0, 1), 0).x;
            float T = texelFetch(u_tex_0, P + ivec2(0, 1), 0).x;
            float div = texelFetch(u_tex_1, P, 0).x;
            float p = (L + R + B + T - div) * 0.25;

            // Mask edges to ensure open border
            vec2 borderMask = step(u_pixel, uv) * step(uv, 1.0 - u_pixel);
            float valid = borderMask.x * borderMask.y;
            out_color_0 = vec4(p * valid, 0.0, 0.0, 1.0);
            break;
        }

        // Gradient Subtract + Advect Velocity + Advect Color + Composite
        case 2: {
            // Advect Velocity
            vec4 currentState = texelFetch(u_tex_0, P, 0);
            vec2 pos = uv - currentState.xy * u_dt * u_pixel;
            vec4 advectedState = textureLod(u_tex_0, pos, 0.0);

            // Gradient Subtract
            float pL = texelFetch(u_tex_1, P - ivec2(1, 0), 0).x;
            float pR = texelFetch(u_tex_1, P + ivec2(1, 0), 0).x;
            float pB = texelFetch(u_tex_1, P - ivec2(0, 1), 0).x;
            float pT = texelFetch(u_tex_1, P + ivec2(0, 1), 0).x;
            vec2 pressureForce = -0.5 * vec2(pR - pL, pT - pB);

            // Forces
            float splat = calcSplatStrength(gl_FragCoord.xy, u_splat_start, u_splat_start2, u_splat_end, u_splat_end2, u_splat_radius);
            vec2 momentum = advectedState.xy * smoothstep(0.0, 1.0, advectedState.z);
            vec2 newVel = momentum + pressureForce + u_gravity + u_splat_velocity * splat;
            float wetness = max(splat, u_viscosity * advectedState.z);
            out_color_0 = vec4(newVel, wetness, 1.0);

            // Advect Color
            vec4 bg = texelFetch(u_tex_2, P, 0);
            vec2 posColor = uv - newVel * u_dt * u_pixel;
            vec4 currentColor = textureLod(u_tex_3, posColor, 0.0);
            float wetnessTest = step(0.1, wetness);
            vec4 src_col = mix(vec4(u_splat_color.rgb * u_splat_color.a, u_splat_color.a), bg, u_dry_blend);
            vec4 brush = src_col * splat;
            vec4 fg = wetnessTest * (brush + currentColor * (1.0 - brush.a));

            // Stochastic blur, using triangular distribution
            if (u_blur_strength > EPSILON) {
                vec4 rnd = hash42(gl_FragCoord.xy + u_rand * 50.0);
                vec2 triangleNoise = vec2(rnd.x + rnd.y - 1.0, rnd.z + rnd.w - 1.0);
                float blur = clamp(u_blur_strength * splat, 0.0, 1.0);
                vec2 offset = triangleNoise * blur * u_splat_radius * u_pixel;
                vec4 bg_adj = textureLod(u_tex_2, uv + offset, 0.0);
                bg = mix(bg, bg_adj, blur);
            }

            // Fade
            if (u_fade_strength > EPSILON) {
                float fade = clamp(1.0 - u_fade_strength * splat, 0.0, 1.0);
                bg *= fade;
                fg *= fade;
            }

            // Composite. The "mix" calls are done to prevent accumulating floating point errors
            float stdAlpha = fg.a + bg.a * (1.0 - fg.a);
            vec3 stdRGB = fg.rgb + bg.rgb * (1.0 - fg.a);
            float targetAlpha = max(fg.a, bg.a);
            float scale = mix(1.0, targetAlpha / max(stdAlpha, EPSILON), step(EPSILON, stdAlpha));
            vec4 blendedResult = vec4(stdRGB * scale, targetAlpha);
            bg = mix(bg, blendedResult, step(EPSILON, fg.a));

            out_color_1 = fg;
            out_color_2 = bg;
            break;
        }

        // Display
        case 3: {
            vec2 bounds = step(vec2(0.0), uv) * step(uv, vec2(1.0));
            float mask = bounds.x * bounds.y;
            vec4 layer = texture(u_tex_0, uv);
            vec3 color = layer.rgb + u_background_color * (1.0 - layer.a);
            out_color_0 = mix(vec4(0.0, 0.0, 0.0, 1.0), vec4(color, 1.0), mask);
            break;
        }

        // Image Copy/Set
        case 4: {
            vec2 bounds = step(vec2(0.0), uv) * step(uv, vec2(1.0));
            out_color_0 = texture(u_tex_0, uv) * (bounds.x * bounds.y);
            break;
        }

        // Error
        default: {
            out_color_0 = vec4(1.0, 0.0, 0.0, 1.0);
        }
    }
}
#if canImport(Metal)
    /// Liquid splash: iridescent fluid filaments streaming out of a bright core, lit like glossy liquid, with shaded
    /// droplets and fine spray flying outward. One analytic pass. The filaments are ridged 3-D value noise sampled on a
    /// cylinder (angle on the circle, radius along it), so they are seamless around the core and stream outward with
    /// `travel`; a finite-difference normal gives each strand a diffuse side and a white specular edge, and the hue
    /// drifts with the normal for the oil-film look. Bass (band 0.05) sets the reach of the splash and the core,
    /// mids (0.4) the warp, highs (0.8) the spray; the kick swells the core, the snare throws a ring of spray, the drop
    /// winds the arms. The only full-screen flash is the rationed `extra.x`.
    enum LiquidSplashShader {
        static let source = #"""
            static float splashHash31(float3 p) {
                p = fract(p * float3(0.1031, 0.1030, 0.0973));
                p += dot(p, p.yxz + 33.33);
                return fract((p.x + p.y) * p.z);
            }

            static float splashNoise3(float3 p) {
                float3 i = floor(p);
                float3 f = fract(p);
                f = f * f * (3.0 - 2.0 * f);
                float n000 = splashHash31(i);
                float n100 = splashHash31(i + float3(1, 0, 0));
                float n010 = splashHash31(i + float3(0, 1, 0));
                float n110 = splashHash31(i + float3(1, 1, 0));
                float n001 = splashHash31(i + float3(0, 0, 1));
                float n101 = splashHash31(i + float3(1, 0, 1));
                float n011 = splashHash31(i + float3(0, 1, 1));
                float n111 = splashHash31(i + float3(1, 1, 1));
                float x00 = mix(n000, n100, f.x);
                float x10 = mix(n010, n110, f.x);
                float x01 = mix(n001, n101, f.x);
                float x11 = mix(n011, n111, f.x);
                return mix(mix(x00, x10, f.y), mix(x01, x11, f.y), f.z);
            }

            static float splashFbm3(float3 p) {
                float v = 0.0;
                float a = 0.5;
                for (int i = 0; i < 3; i++) {
                    v += a * splashNoise3(p);
                    p = p * 2.07 + float3(11.3, 7.9, 3.1);
                    a *= 0.5;
                }
                return v;
            }

            // The filament field at a point: the swirled, warped position sampled on a cylinder so the strands stream
            // outward from the core. Returns the raw noise (filaments sit where it crosses 0.5).
            static float splashField(float2 p, float travel, float t, float warp, float swirl, float scale) {
                float r = length(p) + 1e-4;
                float a = atan2(p.y, p.x) + swirl * r;
                float2 q = float2(cos(a), sin(a)) * r;
                float2 w = float2(fbm(q * 1.6 + float2(t * 0.09, -t * 0.06)), fbm(q * 1.6 + float2(4.7 - t * 0.07, 2.3 + t * 0.05)));
                q += (w - 0.5) * warp;
                float rr = length(q) + 1e-4;
                float2 dir = q / rr;
                return splashFbm3(float3(dir * scale * 1.5, rr * scale * 0.55 - travel * 0.35));
            }

            static float splashRidge(float f, float thin) {
                float ridge = 1.0 - abs(f * 2.0 - 1.0);
                return pow(smoothstep(thin, 1.0, ridge), 2.2);
            }

            // One layer of droplets: each grid cell owns one sphere that flies outward through the cell and fades at
            // both ends of its flight. Shaded as a ball with a white specular and a palette rim.
            static float3 splashDroplets(
                float2 p, float cs, float travel, float speed, float seed, float density, float highs,
                constant IntenseUniforms &u, float3 light) {
                float2 id = floor(p / cs);
                float h = hash21(id + seed);
                if (h > density) return float3(0.0);
                float h2 = hash21(id * 1.73 + seed + 5.1);
                float h3 = hash21(id * 0.61 + seed + 9.7);
                float2 c = (id + 0.5) * cs;
                float cl = length(c);
                float2 dir = cl > 1e-3 ? c / cl : float2(1.0, 0.0);
                float phase = fract(h2 + travel * speed * (0.6 + 0.8 * h3));
                float2 pos = c + dir * (phase - 0.5) * cs * 0.7;
                float radius = cs * (0.09 + 0.16 * h3) * (0.75 + 0.5 * highs);
                float2 rel = (p - pos) / radius;
                float d2 = dot(rel, rel);
                if (d2 > 1.0) return float3(0.0);
                float d = sqrt(d2);
                float z = sqrt(max(1.0 - d2, 0.0));
                float3 n = float3(rel, z);
                float diff = 0.25 + 0.75 * max(dot(n, light), 0.0);
                float spec = pow(max(dot(reflect(-light, n), float3(0.0, 0.0, 1.0)), 0.0), 24.0);
                float rim = smoothstep(0.55, 1.0, d);
                float body = 1.0 - smoothstep(0.9, 1.0, d);
                float life = sin(phase * 3.14159);
                float reach = smoothstep(0.12, 0.32, length(pos)) * smoothstep(1.5, 0.9, length(pos));
                float3 tint = paletteAt(u, atan2(pos.y, pos.x) / 6.28318 + 0.5 + 0.06 * h);
                float3 col = tint * (0.12 + 0.5 * diff) * (1.0 - 0.7 * rim) + tint * rim * 1.3 + float3(1.0) * spec * 1.3;
                return col * body * life * reach;
            }

            fragment float4 liquidSplashFragment(
                IntenseVertexOut in [[stage_in]], constant IntenseUniforms &u [[buffer(0)]],
                constant float *spectrum [[buffer(1)]], constant float *wave [[buffer(2)]]) {
                float aspect = u.resTime.x / u.resTime.y;
                float intensity = u.extra.z;
                float time = u.resTime.z * intensity;
                float travel = u.misc.z * intensity;
                float kick = u.env.x;
                float snare = u.env.y;
                float hat = u.env.z;
                float energy = u.wobble.z;
                float drop = u.misc.y;
                float bass = bandAt(spectrum, 0.05);
                float mids = bandAt(spectrum, 0.4);
                float highs = bandAt(spectrum, 0.8);

                float2 p = (in.uv - 0.5) * float2(aspect, 1.0) * 2.0;
                p += u.fx.zw * 0.04 * intensity;
                p *= 1.0 - 0.05 * kick * intensity;
                float r = length(p);
                float a = atan2(p.y, p.x);

                // The splash: two coarse and fine filament fields, each lit from a finite-difference normal.
                float warp = (0.25 + 0.35 * mids + 0.2 * energy) * (0.5 + 0.5 * intensity);
                float swirl = (0.08 + 0.45 * drop) * intensity;
                float reach = 0.55 + 0.6 * bass + 0.35 * drop + 0.15 * energy;
                float envelope = smoothstep(reach + 0.45, reach * 0.45, r) * smoothstep(0.0, 0.1, r);
                float arms = 0.25 + 0.75 * pow(0.5 + 0.5 * cos(a * 3.0 - travel * 0.1), 1.0);
                float3 light = normalize(float3(-0.45, 0.55, 0.7));
                float3 col = float3(0.0);
                float hueBase = a / 6.28318 + 0.5 + travel * 0.008;
                for (int layer = 0; layer < 2; layer++) {
                    float scale = layer == 0 ? 2.3 : 5.1;
                    float e = layer == 0 ? 0.012 : 0.007;
                    float f0 = splashField(p, travel, time, warp, swirl, scale);
                    float fx = splashField(p + float2(e, 0.0), travel, time, warp, swirl, scale);
                    float fy = splashField(p + float2(0.0, e), travel, time, warp, swirl, scale);
                    float thin = layer == 0 ? 0.80 - 0.08 * energy : 0.88 - 0.05 * energy;
                    float strand = splashRidge(f0, thin);
                    float3 n = normalize(float3(-(fx - f0) / e, -(fy - f0) / e, layer == 0 ? 5.0 : 8.0));
                    float diff = 0.35 + 0.65 * max(dot(n, light), 0.0);
                    float spec = pow(max(dot(reflect(-light, n), float3(0.0, 0.0, 1.0)), 0.0), 28.0);
                    float3 tint = paletteAt(u, hueBase + 0.14 * n.x + 0.1 * (f0 - 0.5) + float(layer) * 0.05);
                    float weight = layer == 0 ? 1.0 : 0.6;
                    float lit = strand * envelope * arms * weight * (0.8 + 0.5 * energy + 0.4 * kick);
                    col += tint * diff * lit * 1.6 + float3(1.0) * spec * lit * 1.1;
                }
                // Haze between the strands: a dim wash of the field so the splash reads as a body of liquid.
                float haze = splashField(p * 0.8, travel, time, warp, swirl, 1.4);
                col += paletteAt(u, hueBase + 0.3) * haze * haze * haze * envelope * arms * 0.1;

                // Droplets: big slow spheres, then fine spray that thickens with the highs and the hats.
                float density = 0.42 + 0.3 * highs + 0.2 * hat;
                col += splashDroplets(p, 0.26, travel, 0.07, 1.0, 0.55, highs, u, light);
                col += splashDroplets(p + float2(0.13, 0.07), 0.16, travel, 0.11, 7.0, 0.5 + 0.2 * energy, highs, u, light);
                col += splashDroplets(p, 0.07, travel, 0.2, 13.0, density, highs, u, light) * 0.9;

                // Snare: a ring of light runs outward through the splash.
                float ringR = 0.12 + (1.0 - snare) * 1.2;
                float ring = exp(-pow((r - ringR) * 9.0, 2.0)) * snare;
                col += mix(u.c2.rgb, float3(1.0), 0.45) * ring * 0.45 * (0.5 + envelope);

                // The core where the streams meet, breathing with the bass and jumping on the kick.
                float core = exp(-r * r * 11.0) * (0.12 + 0.5 * bass + 0.4 * kick);
                col += mix(u.c1.rgb, float3(1.0), 0.6) * core;
                col += mix(u.c0.rgb, u.c2.rgb, 0.5) * exp(-r * r * 2.5) * 0.06 * (0.5 + energy);

                col += u.flashColor.rgb * u.extra.x * 0.3;
                col = 1.0 - exp(-col * 1.4);
                col *= 1.0 - 0.3 * dot(p, p) * 0.3;
                return float4(clamp(col, 0.0, 1.0), 1.0);
            }
            """#
    }
#endif

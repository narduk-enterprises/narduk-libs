#if canImport(Metal)
    /// Sun: a close-up star filling the center. The photosphere is a sphere of seething granulation (bright cells,
    /// dark lanes, two scales, lit in relief) with drifting sunspots and limb darkening, rotating with `travel`; a
    /// chromosphere of fine spicules fringes the limb; ridged corona streamers (`fxCylinder`) blow outward; prominence
    /// loops erupt from the limb on the snare; solar-wind sparks fly toward the viewer through zoom layers; a dim
    /// starfield sits far behind. Bass swells the disc and the corona's reach and burns the surface hotter, mids churn
    /// the granulation and raise the sunspots, highs thicken the spicules and the sparks, the kick flares an active
    /// region across the disc, the beat pulses the corona and the drop winds the streamers faster and tighter. The
    /// palette tints the corona; the surface keeps a temperature ramp so it always reads as a sun. Second consumer of
    /// the shared `IntenseEffects` library.
    enum SunShader {
        static let source = #"""
            // Temperature ramp: cool umbra red, orange, yellow, white-hot.
            static float3 sunRamp(float t) {
                t = clamp(t, 0.0, 1.0);
                float3 umbra = float3(0.22, 0.02, 0.0);
                float3 orange = float3(0.96, 0.32, 0.03);
                float3 yellow = float3(1.0, 0.80, 0.22);
                float3 white = float3(1.0, 0.98, 0.86);
                if (t < 0.33) return mix(umbra, orange, t / 0.33);
                if (t < 0.66) return mix(orange, yellow, (t - 0.33) / 0.33);
                return mix(yellow, white, (t - 0.66) / 0.34);
            }

            // A point on the photosphere for the pixel: the sphere normal rotated about the vertical axis by `spin`
            // so the surface turns with the music.
            static float3 sunSurface(float2 q, float z, float spin) {
                float c = cos(spin);
                float s = sin(spin);
                return float3(q.x * c - z * s, q.y, q.x * s + z * c);
            }

            // A prominence loop: a thin arc of plasma anchored at `anchor` on the limb, rising to `loopRadius`,
            // drawn only outside the disc. Returns its brightness at p.
            static float sunLoop(float2 p, float2 anchor, float loopRadius, float discRadius) {
                float r = length(p);
                if (r < discRadius) return 0.0;
                float d = abs(length(p - anchor) - loopRadius);
                float arc = exp(-pow(d * 70.0, 2.0));
                float lift = smoothstep(discRadius, discRadius + 0.02, r);
                return arc * lift;
            }

            fragment float4 sunFragment(
                IntenseVertexOut in [[stage_in]], constant IntenseUniforms &u [[buffer(0)]],
                constant float *spectrum [[buffer(1)]], constant float *wave [[buffer(2)]]) {
                float aspect = u.resTime.x / u.resTime.y;
                float intensity = u.extra.z;
                float time = u.resTime.z * intensity;
                float travel = u.misc.z * intensity;
                float beats = u.resTime.w;
                float kick = u.env.x;
                float snare = u.env.y;
                float hat = u.env.z;
                float energy = u.wobble.z;
                float drop = u.misc.y;
                float bass = bandAt(spectrum, 0.05);
                float mids = bandAt(spectrum, 0.4);
                float highs = bandAt(spectrum, 0.8);
                float beatPulse = pow(1.0 - fract(beats), 2.0);

                float2 p = (in.uv - 0.5) * float2(aspect, 1.0) * 2.0;
                p += u.fx.zw * 0.03 * intensity;
                float r = length(p);
                float a = atan2(p.y, p.x);
                float R = 0.56 + 0.08 * bass + 0.04 * kick * intensity;
                float3 light = fxKeyLight();
                float3 col = float3(0.0);

                if (r < R + 0.004) {
                    // The photosphere: a sphere, rotating, seething with granulation.
                    float2 q = p / R;
                    float z = sqrt(max(1.0 - dot(q, q), 0.0));
                    float spin = travel * 0.035 + time * 0.01;
                    float3 sp = sunSurface(q, z, spin);
                    float churn = 0.25 + 0.6 * mids + 0.2 * energy;
                    float3 gp = sp * 9.0 + float3(0.0, 0.0, time * 0.12);
                    float3 warp = float3(fxNoise3(sp * 4.0 + time * 0.1), fxNoise3(sp * 4.0 + 5.0 - time * 0.08), 0.0);
                    gp += (warp - 0.5) * churn;
                    float e = 0.02;
                    float g0 = fxFbm3(gp, 3);
                    float gx = fxFbm3(gp + float3(e, 0.0, 0.0), 3);
                    float gy = fxFbm3(gp + float3(0.0, e, 0.0), 3);
                    float lanes = fxRidge(g0, 0.5);
                    float fine = fxNoise3(sp * 26.0 + float3(time * 0.2, 0.0, travel * 0.05));
                    float cell = 1.0 - lanes * 0.9;
                    float3 n = fxNormal(g0, gx, gy, e, 0.55);
                    float2 shade = fxLight(n, light, 10.0);
                    // The sphere itself is lit: a soft terminator toward the lower right gives the ball its volume.
                    float3 sphereN = float3(q, z);
                    float volume = 0.62 + 0.38 * max(dot(sphereN, light), 0.0);

                    // Sunspots: umbra and penumbra, rising with the mids. An active region flares on the kick.
                    float spotField = fxFbm3(sp * 5.5 + float3(17.0, 3.0, 1.0) + time * 0.015, 2);
                    float spotLevel = 0.66 - 0.08 * mids;
                    float penumbra = smoothstep(spotLevel - 0.06, spotLevel, spotField);
                    float umbra = smoothstep(spotLevel + 0.01, spotLevel + 0.05, spotField);
                    float faculae = smoothstep(spotLevel - 0.14, spotLevel - 0.07, spotField) * (1.0 - penumbra);
                    float sx = fxFbm3(sp * 5.5 + float3(17.0 + 0.03, 3.0, 1.0) + time * 0.015, 2);
                    float sy = fxFbm3(sp * 5.5 + float3(17.0, 3.0 + 0.03, 1.0) + time * 0.015, 2);
                    float3 spotN = fxNormal(spotField, sx, sy, 0.03, 0.35);
                    float spotLit = 0.6 + 0.8 * max(dot(-spotN, light), 0.0);
                    float active = smoothstep(0.55, 0.75, fxNoise3(sp * 2.6 + float3(41.0, 9.0, 2.0)));
                    float flare = active * kick * intensity;

                    float heat = 0.26 + 0.28 * cell + 0.12 * fine + 0.08 * bass + 0.05 * energy;
                    heat += 0.4 * flare;
                    heat += 0.18 * faculae;
                    heat = mix(heat, 0.2 * spotLit, penumbra * 0.85);
                    heat = mix(heat, 0.02, umbra);
                    float3 surface = sunRamp(heat);
                    surface *= 0.55 + 0.55 * shade.x;
                    surface += float3(1.0, 0.9, 0.7) * shade.y * 0.22 * cell;
                    float limb = 1.0 - 0.78 * pow(1.0 - z, 1.25);
                    surface *= limb * volume;
                    surface *= 0.95 + 0.2 * bass + 0.25 * flare;
                    float edge = 1.0 - smoothstep(R - 0.006, R + 0.004, r);
                    col += surface * edge;
                }

                if (r > R - 0.02) {
                    float d = max(r - R, 0.0);
                    // Chromosphere: fine spicules fringing the limb, thicker with the highs and the hats.
                    float3 sq = fxCylinder(p, 34.0, travel, 0.18);
                    float spic = fxRidge(fxFbm3(sq, 2), 0.66);
                    float fringe = exp(-d * (34.0 - 10.0 * highs)) * (0.35 + 0.65 * highs + 0.3 * hat);
                    col += sunRamp(0.42) * spic * fringe * 1.6 + sunRamp(0.6) * exp(-d * 60.0) * 0.5;

                    // Corona: two layers of ridged streamers blowing outward, lit in relief, pulsing on the beat.
                    float stream = 0.22 + 0.5 * drop;
                    float reach = 0.09 + 0.16 * bass + 0.14 * drop + 0.03 * energy;
                    float fall = exp(-d / reach) * smoothstep(0.0, 0.03, d) * smoothstep(0.6, 0.2, d);
                    float pulse = 0.72 + 0.28 * beatPulse * intensity;
                    float3 tintBase = mix(sunRamp(0.6), paletteAt(u, a / 6.28318 + 0.5 + travel * 0.01), 0.18);
                    for (int layer = 0; layer < 2; layer++) {
                        float scale = layer == 0 ? 4.2 : 9.5;
                        float thin = layer == 0 ? 0.82 - 0.05 * drop : 0.88;
                        float ec = 0.012;
                        float f0 = fxFbm3(fxCylinder(p, scale, travel, stream), 3);
                        float strand = fxRidge(f0, thin);
                        float weight = layer == 0 ? 1.0 : 0.55;
                        float3 tint = mix(tintBase, sunRamp(0.8), float(layer) * 0.4);
                        if (layer == 0) {
                            float fx = fxFbm3(fxCylinder(p + float2(ec, 0.0), scale, travel, stream), 3);
                            float fy = fxFbm3(fxCylinder(p + float2(0.0, ec), scale, travel, stream), 3);
                            float3 n = fxNormal(f0, fx, fy, ec, 6.0);
                            float2 shade = fxLight(n, light, 20.0);
                            col += (tint * shade.x + float3(1.0) * shade.y * 0.5) * strand * fall * pulse * weight * 1.9;
                        } else {
                            col += tint * strand * fall * pulse * weight * 1.5;
                        }
                    }
                    // The corona's soft body and the outer glow.
                    col += sunRamp(0.5) * exp(-d * 22.0) * 0.2 * (0.6 + 0.4 * bass) * pulse;

                    // Prominence loops erupt from the limb on the snare and lift away as it fades.
                    float bar = floor(beats / 4.0);
                    float a0 = hash11(bar + 3.0) * 6.28318;
                    float a1 = a0 + 2.4 + hash11(bar + 11.0);
                    float rise = 1.0 - snare;
                    float loop = sunLoop(p, float2(cos(a0), sin(a0)) * R, 0.09 + 0.22 * rise, R)
                        + sunLoop(p, float2(cos(a1), sin(a1)) * R, 0.06 + 0.16 * rise, R) * 0.7;
                    col += mix(sunRamp(0.45), float3(1.0, 0.75, 0.8), 0.4) * loop * snare * 2.6 * intensity;

                    // Eruption: on the kick a plume of plasma blasts out of an active region on the limb and
                    // dissipates; the ridged corona field gives it structure.
                    float aK = hash11(bar + 29.0) * 6.28318;
                    float da = atan2(sin(a - aK), cos(a - aK));
                    float cone = exp(-da * da * (10.0 - 4.0 * kick));
                    float blast = fxRidge(fxFbm3(fxCylinder(p, 7.0, travel, 0.9), 3), 0.6);
                    float plume = cone * exp(-d / (0.05 + 0.3 * kick)) * (0.4 + 0.6 * blast) * kick * intensity;
                    col += mix(sunRamp(0.7), float3(1.0, 0.95, 0.8), 0.5) * plume * 2.4;

                    // Solar wind: sparks that fly out of the star and grow as they near the viewer.
                    float density = 0.04 + 0.12 * highs + 0.08 * hat + 0.08 * drop;
                    for (int k = 0; k < 2; k++) {
                        float offset = float(k) * 0.5;
                        FxZoomLayer zl = fxZoomLayer(p, fract(travel * (0.11 + 0.08 * drop) + offset));
                        float2 c;
                        float h;
                        if (fxCell(zl.q, 0.11, 21.0 + offset, density, c, h)) {
                            float screenDistance = length(c) * zl.scale;
                            float2 rel = zl.q - c;
                            float2 dir = normalize(c + 1e-4);
                            float along = dot(rel, dir);
                            float across = abs(dot(rel, float2(-dir.y, dir.x)));
                            float streak = exp(-across * across * 6000.0) * exp(-along * along * 2500.0) * smoothstep(-0.01, 0.0, along);
                            float spark = exp(-dot(rel, rel) * 6000.0) + streak * 0.5;
                            float reachS = smoothstep(R * 1.05, R * 1.3, screenDistance) * smoothstep(1.3, 0.95, screenDistance);
                            col += sunRamp(0.75 + 0.25 * h) * spark * zl.fade * reachS * (0.6 + 0.6 * h) * 1.4;
                        }
                    }
                }

                col = fxFlash(col, u, 0.3);
                col = fxTonemap(col, 1.15);
                col = fxVignette(col, p, 0.08);
                return float4(clamp(col, 0.0, 1.0), 1.0);
            }
            """#
    }
#endif

'use client';

import { useEffect } from 'react';

type GlassConfig = {
  glassThickness: number;
  bezelWidth: number;
  ior: number;
  scaleRatio: number;
  blur: number;
  specularOpacity: number;
  specularSat: number;
  tintColor: string;
  tintOpacity: number;
  innerShadow: string;
  innerShadowBlur: number;
  innerShadowSpread: number;
  balancedSpecular: boolean;
};

const SURFACE_CONFIG: GlassConfig = {
  glassThickness: 80,
  bezelWidth: 40,
  ior: 1.4,
  scaleRatio: 1,
  blur: 1,
  specularOpacity: .6,
  specularSat: 0,
  tintColor: '255,255,255',
  tintOpacity: 0,
  innerShadow: 'rgba(255,255,255,0)',
  innerShadowBlur: 0,
  innerShadowSpread: 0,
  balancedSpecular: false,
};

const SWITCHER_CONFIG: GlassConfig = {
  ...SURFACE_CONFIG,
  glassThickness: 30,
  blur: 0,
  specularOpacity: .5,
  balancedSpecular: true,
};

type GlassInstance = { destroy: () => void; rebuild: () => void; isAttached: () => boolean };

export function LiquidGlassRuntime() {
  useEffect(() => {
    const instances = new Map<HTMLElement, GlassInstance>();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:fixed;inset:0;width:0;height:0;pointer-events:none;z-index:-1';
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    svg.appendChild(defs);
    document.documentElement.appendChild(svg);

    let sequence = 0;
    let scanFrame = 0;
    const useWebKitFallback = needsWebKitGlassFallback();
    document.documentElement.toggleAttribute('data-canact-webkit-glass', useWebKitFallback);

    const shouldHaveGlass = (element: HTMLElement) => {
      return !!element.dataset.liquidGlass && element.dataset.liquidGlass !== 'none';
    };

    const scan = () => {
      scanFrame = 0;
      document.querySelectorAll<HTMLElement>('[data-liquid-glass]').forEach((element) => {
        const current = instances.get(element);
        if (current && !current.isAttached()) {
          current.destroy();
          instances.delete(element);
        }
        if (shouldHaveGlass(element) && !instances.has(element)) instances.set(element, mountGlass(element, defs, () => ++sequence, useWebKitFallback));
      });
      instances.forEach((instance, element) => {
        if (!element.isConnected || !shouldHaveGlass(element)) {
          instance.destroy();
          instances.delete(element);
        }
      });
    };
    const scheduleScan = () => { if (!scanFrame) scanFrame = requestAnimationFrame(scan); };
    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'data-liquid-glass', 'data-liquid-radius', 'data-liquid-blur', 'data-liquid-tint', 'data-liquid-tint-opacity'] });
    scan();
    const rebuildAll = () => instances.forEach((instance) => instance.rebuild());
    window.addEventListener('canact:liquid-glass-rebuild', rebuildAll);
    window.addEventListener('resize', rebuildAll, { passive: true });
    window.addEventListener('orientationchange', rebuildAll, { passive: true });
    window.visualViewport?.addEventListener('resize', rebuildAll, { passive: true });

    return () => {
      observer.disconnect();
      if (scanFrame) cancelAnimationFrame(scanFrame);
      window.removeEventListener('canact:liquid-glass-rebuild', rebuildAll);
      window.removeEventListener('resize', rebuildAll);
      window.removeEventListener('orientationchange', rebuildAll);
      window.visualViewport?.removeEventListener('resize', rebuildAll);
      instances.forEach((instance) => instance.destroy());
      instances.clear();
      document.documentElement.removeAttribute('data-canact-webkit-glass');
      svg.remove();
    };
  }, []);
  return null;
}

function mountGlass(element: HTMLElement, defs: SVGDefsElement, nextId: () => number, useWebKitFallback: boolean): GlassInstance {
  if (getComputedStyle(element).position === 'static') element.style.position = 'relative';
  element.classList.add('canact-lg-host');
  const refract = document.createElement('span');
  const tint = document.createElement('span');
  refract.className = 'canact-lg-layer canact-lg-refract';
  tint.className = 'canact-lg-layer canact-lg-tint';
  element.insertBefore(tint, element.firstChild);
  element.insertBefore(refract, element.firstChild);

  let filterNode: SVGFilterElement | null = null;
  let frame = 0;
  const rebuild = () => {
    frame = 0;
    const rect = element.getBoundingClientRect();
    const width = Math.round(element.offsetWidth || rect.width);
    const height = Math.round(element.offsetHeight || rect.height);
    if (width < 4 || height < 4) return;
    const cssRadius = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius || '0');
    const radius = Math.max(2, Math.min(Number(element.dataset.liquidRadius) || cssRadius || 24, width / 2, height / 2));
    const base = element.dataset.liquidGlass === 'switcher' ? SWITCHER_CONFIG : SURFACE_CONFIG;
    const config: GlassConfig = {
      ...base,
      blur: finiteNumber(element.dataset.liquidBlur, base.blur, 0, 20),
      tintColor: element.dataset.liquidTint || base.tintColor,
      tintOpacity: finiteNumber(element.dataset.liquidTintOpacity, base.tintOpacity, 0, 1),
    };
    filterNode?.remove();
    filterNode = null;
    refract.style.borderRadius = `${radius}px`;
    tint.style.borderRadius = `${radius}px`;
    tint.style.backgroundColor = `rgba(${config.tintColor},${config.tintOpacity})`;
    tint.style.boxShadow = `inset 0 0 ${config.innerShadowBlur}px ${config.innerShadowSpread}px ${config.innerShadow}`;
    if (useWebKitFallback) {
      refract.classList.add('canact-lg-webkit-fallback');
      refract.style.backdropFilter = 'brightness(1.06) contrast(1.04) saturate(1.18)';
      refract.style.setProperty('-webkit-backdrop-filter', 'brightness(1.06) contrast(1.04) saturate(1.18)');
      elevateChildren(element, refract, tint);
      return;
    }
    refract.classList.remove('canact-lg-webkit-fallback');
    const id = `canact-lg-${nextId()}`;
    filterNode = buildFilter(id, width, height, radius, config);
    defs.appendChild(filterNode);
    refract.style.backdropFilter = `url(#${id})`;
    refract.style.setProperty('-webkit-backdrop-filter', `url(#${id})`);
    elevateChildren(element, refract, tint);
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(rebuild); };
  const resizeObserver = new ResizeObserver(schedule);
  resizeObserver.observe(element);
  schedule();
  return {
    rebuild,
    isAttached: () => refract.parentElement === element && tint.parentElement === element && (useWebKitFallback || !!filterNode?.isConnected),
    destroy: () => {
      if (frame) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      filterNode?.remove();
      refract.remove();
      tint.remove();
      element.classList.remove('canact-lg-host');
    },
  };
}

function elevateChildren(element: HTMLElement, refract: HTMLElement, tint: HTMLElement) {
  Array.from(element.children).forEach((child) => {
    if (child === refract || child === tint) return;
    const node = child as HTMLElement;
    if (getComputedStyle(node).position === 'static') node.style.position = 'relative';
    if (!node.style.zIndex) node.style.zIndex = '1';
  });
}

function needsWebKitGlassFallback() {
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  const desktopWebKit = /AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg|OPR|Android/.test(ua);
  return iOS || desktopWebKit;
}

function surfaceFn(x: number) { return Math.pow(1 - Math.pow(1 - x, 4), .25); }

function calcRefractionProfile(glassThickness: number, bezelWidth: number, ior: number, samples = 128) {
  const eta = 1 / ior;
  const profile = new Float64Array(samples);
  for (let index = 0; index < samples; index += 1) {
    const x = index / samples;
    const y = surfaceFn(x);
    const dx = x < 1 ? .0001 : -.0001;
    const derivative = (surfaceFn(x + dx) - y) / dx;
    const magnitude = Math.sqrt(derivative * derivative + 1);
    const nx = -derivative / magnitude;
    const ny = -1 / magnitude;
    const dot = ny;
    const k = 1 - eta * eta * (1 - dot * dot);
    if (k < 0) continue;
    const root = Math.sqrt(k);
    const rx = -(eta * dot + root) * nx;
    const ry = eta - (eta * dot + root) * ny;
    profile[index] = rx * ((y * bezelWidth + glassThickness) / ry);
  }
  return profile;
}

function generateDisplacementMap(width: number, height: number, radius: number, bezelWidth: number, profile: Float64Array, maxDisplacement: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  const image = context.createImageData(width, height);
  const data = image.data;
  for (let index = 0; index < data.length; index += 4) { data[index] = 128; data[index + 1] = 128; data[index + 3] = 255; }
  paintBezel(width, height, radius, bezelWidth, (pixel, x, y, fromSide, opacity, distance) => {
    const sample = Math.min(Math.floor((fromSide / bezelWidth) * profile.length), profile.length - 1);
    const displacement = profile[sample] || 0;
    data[pixel] = Math.round(128 + ((-x / distance) * displacement / maxDisplacement) * 127 * opacity);
    data[pixel + 1] = Math.round(128 + ((-y / distance) * displacement / maxDisplacement) * 127 * opacity);
  });
  context.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

function generateSpecularMap(width: number, height: number, radius: number, bezelWidth: number, balanced: boolean) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  const image = context.createImageData(width, height);
  const data = image.data;
  const angle = Math.PI / 3;
  paintBezel(width, height, radius, bezelWidth, (pixel, x, y, fromSide, opacity, distance) => {
    const dot = balanced ? 1 : Math.abs((x / distance) * Math.cos(angle) + (-y / distance) * Math.sin(angle));
    const edge = Math.sqrt(Math.max(0, 1 - Math.pow(1 - fromSide, 2)));
    const coefficient = dot * edge;
    const color = Math.floor(255 * coefficient);
    data[pixel] = color;
    data[pixel + 1] = color;
    data[pixel + 2] = color;
    data[pixel + 3] = Math.floor(color * coefficient * opacity);
  });
  context.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

function paintBezel(width: number, height: number, radius: number, bezelWidth: number, paint: (pixel: number, x: number, y: number, fromSide: number, opacity: number, distance: number) => void) {
  const radiusSquared = radius * radius;
  const outerSquared = (radius + 1) ** 2;
  const innerSquared = Math.max(radius - bezelWidth, 0) ** 2;
  const bodyWidth = width - radius * 2;
  const bodyHeight = height - radius * 2;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const x = column < radius ? column - radius : column >= width - radius ? column - radius - bodyWidth : 0;
      const y = row < radius ? row - radius : row >= height - radius ? row - radius - bodyHeight : 0;
      const distanceSquared = x * x + y * y;
      if (distanceSquared > outerSquared || distanceSquared < innerSquared) continue;
      const distance = Math.sqrt(distanceSquared);
      if (!distance) continue;
      const opacity = distanceSquared < radiusSquared ? 1 : 1 - (distance - radius) / (Math.sqrt(outerSquared) - radius);
      if (opacity > 0) paint((row * width + column) * 4, x, y, radius - distance, opacity, distance);
    }
  }
}

function buildFilter(id: string, width: number, height: number, radius: number, config: GlassConfig) {
  const bezel = Math.max(1, Math.min(config.bezelWidth, radius - 1, Math.min(width, height) / 2 - 1));
  const profile = calcRefractionProfile(config.glassThickness, bezel, config.ior);
  const maxDisplacement = Math.max(...Array.from(profile, Math.abs)) || 1;
  const displacementUrl = generateDisplacementMap(width, height, radius, bezel, profile, maxDisplacement);
  const specularUrl = generateSpecularMap(width, height, radius, bezel * 2.5, config.balancedSpecular);
  const pad = config.balancedSpecular ? .36 : 0;
  const filter = svgElement('filter', { id, x: -width * pad, y: -height * pad, width: width * (1 + pad * 2), height: height * (1 + pad * 2), filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' }) as SVGFilterElement;
  filter.append(
    svgElement('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: config.blur, result: 'blurred' }),
    svgElement('feImage', { href: displacementUrl, x: 0, y: 0, width, height, result: 'disp_map' }),
    svgElement('feDisplacementMap', { in: 'blurred', in2: 'disp_map', scale: maxDisplacement * config.scaleRatio, xChannelSelector: 'R', yChannelSelector: 'G', result: 'displaced' }),
    svgElement('feColorMatrix', { in: 'displaced', type: 'saturate', values: config.specularSat, result: 'displaced_sat' }),
  );
  const spec = svgElement('feImage', { href: specularUrl, x: 0, y: 0, width, height, result: 'spec_layer' });
  const composite = svgElement('feComposite', { in: 'displaced_sat', in2: 'spec_layer', operator: 'in', result: 'spec_masked' });
  const transfer = svgElement('feComponentTransfer', { in: 'spec_layer', result: 'spec_faded' });
  transfer.appendChild(svgElement('feFuncA', { type: 'linear', slope: config.specularOpacity }));
  filter.append(spec, composite, transfer, svgElement('feBlend', { in: 'spec_masked', in2: 'displaced', mode: 'normal', result: 'with_sat' }), svgElement('feBlend', { in: 'spec_faded', in2: 'with_sat', mode: 'normal' }));
  return filter;
}

function svgElement(tag: string, attributes: Record<string, string | number>) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
}

function finiteNumber(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

// Chip de IA 3D procedural em WebGL. Funciona mesmo com index.html aberto por file://.
(() => {
  const canvas = document.getElementById('ai-model-canvas');
  const stage = canvas?.parentElement;
  const hero = document.querySelector('.hero');
  const gestureZone = document.getElementById('chip-gesture-zone');
  if (!canvas || !stage || !hero) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let gl;
  try {
    gl = canvas.getContext('webgl', {
      alpha: true, antialias: true, depth: true,
      premultipliedAlpha: false, powerPreference: 'low-power'
    });
  } catch (_) { return; }
  if (!gl) return;

  const vertexSource = `
    attribute vec3 aPosition;
    attribute vec3 aColor;
    attribute float aSize;
    uniform mat4 uProjection;
    uniform vec3 uRotation;
    uniform float uPointScale;
    varying vec3 vColor;
    void main() {
      float cz = cos(uRotation.z), sz = sin(uRotation.z);
      float cy = cos(uRotation.y), sy = sin(uRotation.y);
      float cx = cos(uRotation.x), sx = sin(uRotation.x);
      vec3 p = aPosition;
      p = vec3(cz * p.x - sz * p.y, sz * p.x + cz * p.y, p.z);
      p = vec3(cy * p.x + sy * p.z, p.y, -sy * p.x + cy * p.z);
      p = vec3(p.x, cx * p.y - sx * p.z, sx * p.y + cx * p.z);
      p.z -= 6.4;
      gl_Position = uProjection * vec4(p, 1.0);
      gl_PointSize = clamp(aSize * uPointScale / -p.z, 1.0, 42.0);
      vColor = aColor;
    }
  `;
  const fragmentSource = `
    precision mediump float;
    varying vec3 vColor;
    uniform float uOpacity;
    uniform float uPointMode;
    void main() {
      float alpha = uOpacity;
      if (uPointMode > 0.5) {
        float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
        alpha *= pow(max(0.0, 1.0 - d), 1.45);
      }
      gl_FragColor = vec4(vColor, alpha);
    }
  `;

  function compile(type, source) {
    const result = gl.createShader(type);
    gl.shaderSource(result, source);
    gl.compileShader(result);
    if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(result));
    return result;
  }

  let program;
  try {
    program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  } catch (_) { return; }

  const attr = {
    position: gl.getAttribLocation(program, 'aPosition'),
    color: gl.getAttribLocation(program, 'aColor'),
    size: gl.getAttribLocation(program, 'aSize')
  };
  const uni = {
    projection: gl.getUniformLocation(program, 'uProjection'),
    rotation: gl.getUniformLocation(program, 'uRotation'),
    scale: gl.getUniformLocation(program, 'uPointScale'),
    opacity: gl.getUniformLocation(program, 'uOpacity'),
    pointMode: gl.getUniformLocation(program, 'uPointMode')
  };

  const body = [];
  const traces = [];
  const backTraces = [];
  const rays = [];
  const nodes = [];
  const backNodes = [];
  const paths = [];

  const shade = (color, factor) => color.map(v => Math.min(1, v * factor));
  function vertex(target, p, color, size = 0) {
    target.push(p[0], p[1], p[2], color[0], color[1], color[2], size);
  }
  function quad(target, a, b, c, d, color) {
    vertex(target, a, color); vertex(target, b, color); vertex(target, c, color);
    vertex(target, a, color); vertex(target, c, color); vertex(target, d, color);
  }
  function box(cx, cy, cz, width, height, depth, color) {
    const x0 = cx - width / 2, x1 = cx + width / 2;
    const y0 = cy - height / 2, y1 = cy + height / 2;
    const z0 = cz - depth / 2, z1 = cz + depth / 2;
    quad(body, [x0,y0,z1], [x1,y0,z1], [x1,y1,z1], [x0,y1,z1], shade(color, 1.13));
    quad(body, [x1,y0,z0], [x0,y0,z0], [x0,y1,z0], [x1,y1,z0], shade(color, .42));
    quad(body, [x1,y0,z1], [x1,y0,z0], [x1,y1,z0], [x1,y1,z1], shade(color, .72));
    quad(body, [x0,y0,z0], [x0,y0,z1], [x0,y1,z1], [x0,y1,z0], shade(color, .55));
    quad(body, [x0,y1,z1], [x1,y1,z1], [x1,y1,z0], [x0,y1,z0], shade(color, .92));
    quad(body, [x0,y0,z0], [x1,y0,z0], [x1,y0,z1], [x0,y0,z1], shade(color, .48));
  }
  function segment(target, a, b, color) {
    vertex(target, a, color); vertex(target, b, color);
  }
  function strip(target, a, b, width, color) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length * width / 2, ny = dx / length * width / 2;
    quad(target,
      [a[0]+nx,a[1]+ny,a[2]], [b[0]+nx,b[1]+ny,b[2]],
      [b[0]-nx,b[1]-ny,b[2]], [a[0]-nx,a[1]-ny,a[2]], color);
  }
  function trace(a, b, width = .018, color = [.42, .62, 1]) {
    strip(traces, a, b, width, color);
  }
  function backTrace(a, b, width = .018, color = [.42, .62, 1]) {
    strip(backTraces, a, b, width, color);
  }
  function path(points, color) {
    for (let i = 0; i < points.length - 1; i++) trace(points[i], points[i+1], .018, color);
    paths.push(points);
    for (const p of points) vertex(nodes, p, [.75, .88, 1], .07);
  }

  // Corpo, moldura metálica e processador central, todos com espessura real.
  box(0, 0, 0, 2.35, 2.35, .24, [.15, .21, .39]);
  box(0, 0, .15, 2.14, 2.14, .075, [.38, .48, .72]);
  box(0, 0, .205, 1.98, 1.98, .042, [.065, .10, .24]);
  box(0, 0, .245, 1.40, 1.40, .055, [.16, .23, .51]);
  box(0, 0, .315, 1.10, 1.10, .095, [.24, .37, .77]);
  box(0, 0, .385, .69, .69, .052, [.42, .58, .94]);
  box(0, 0, .425, .37, .37, .036, [.60, .75, 1]);

  // A face traseira tem uma placa própria, circuito e núcleo secundário.
  box(0, 0, -.16, 2.10, 2.10, .07, [.22, .33, .58]);
  quad(body, [-1.02,-1.02,-.198], [1.02,-1.02,-.198], [1.02,1.02,-.198], [-1.02,1.02,-.198], [.23,.35,.61]);
  box(0, 0, -.225, 1.02, 1.02, .06, [.30, .43, .70]);
  quad(body, [-.49,-.49,-.258], [.49,-.49,-.258], [.49,.49,-.258], [-.49,.49,-.258], [.25,.40,.74]);
  box(0, 0, -.275, .43, .43, .04, [.48,.65,.95]);

  // Pinos de metal em quatro lados do chip.
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 12; i++) {
      const u = -1.015 + i * (2.03 / 11);
      const tint = i % 3 === 0 ? [.52,.68,.94] : [.36,.49,.72];
      box(side * 1.34, u, -.045, .38, .078, .11, tint);
      box(u, side * 1.34, -.045, .078, .38, .11, tint);
    }
  }

  // Trilhas do circuito em quatro direções, com pontos luminosos e pulsos.
  const bright = [.58, .77, 1];
  const quiet = [.32, .48, .84];
  for (let i = 0; i < 9; i++) {
    const u = (i - 4) * .19;
    const bend = (i - 4) * .24;
    for (const side of [-1, 1]) {
      const color = i % 3 === 0 ? bright : quiet;
      path([[side*.56,u*.7,.452], [side*.69,u*.7,.452], [side*.80,bend,.452], [side*1.045,bend,.452]], color);
      path([[u*.7,side*.56,.452], [u*.7,side*.69,.452], [bend,side*.80,.452], [bend,side*1.045,.452]], color);
    }
  }

  // Linhas nos contornos do chip e da pastilha interna.
  for (const [radius, z, color] of [
    [1.055,.247,[.57,.72,.98]], [.695,.280,[.39,.57,.97]], [.55,.370,[.73,.88,1]], [.34,.419,[.84,.95,1]]
  ]) {
    const corners = [[-radius,-radius,z],[radius,-radius,z],[radius,radius,z],[-radius,radius,z]];
    for (let i=0;i<4;i++) trace(corners[i], corners[(i+1)%4], .014, color);
  }

  for (const radius of [1.00, .50, .205]) {
    const z = -.302;
    const corners = [[-radius,-radius,z],[radius,-radius,z],[radius,radius,z],[-radius,radius,z]];
    for (let i=0;i<4;i++) backTrace(corners[i], corners[(i+1)%4], .018, [.62,.79,1]);
  }
  for (let i=0;i<8;i++) {
    const u = (i - 3.5) * .24;
    for (const side of [-1, 1]) {
      const z = -.302;
      const fromX = [side*.52,u*.55,z];
      const bendX = [side*.72,u*.55,z];
      const endX = [side*.99,u,z];
      backTrace(fromX,bendX,.018,[.42,.59,.91]);
      backTrace(bendX,endX,.018,[.42,.59,.91]);
      const fromY = [u*.55,side*.52,z];
      const bendY = [u*.55,side*.72,z];
      const endY = [u,side*.99,z];
      backTrace(fromY,bendY,.018,[.42,.59,.91]);
      backTrace(bendY,endY,.018,[.42,.59,.91]);
      if (i % 2 === 0) {
        vertex(backNodes, endX, [.78,.89,1], .09);
        vertex(backNodes, endY, [.78,.89,1], .09);
      }
    }
  }
  for (const x of [-.86,.86]) for (const y of [-.86,.86]) {
    vertex(backNodes, [x,y,-.304], [.86,.94,1], .14);
  }

  // Extensões externas lembram dados saindo do processador.
  for (let i = 0; i < 12; i++) {
    const u = -1.015 + i * (2.03 / 11);
    for (const side of [-1, 1]) {
      const reach = .18 + (i % 4) * .065;
      const endX = side * (1.58 + reach);
      const endY = side * (1.58 + reach);
      segment(rays, [side*1.53,u,.015], [endX,u,.015], [.37,.52,.88]);
      segment(rays, [u,side*1.53,.015], [u,endY,.015], [.37,.52,.88]);
      if (i % 2 === 0) {
        vertex(nodes, [endX,u,.015], [.67,.83,1], .115);
        vertex(nodes, [u,endY,.015], [.67,.83,1], .115);
      }
    }
  }
  vertex(nodes, [0,0,.465], [1,1,1], .36);

  function makeBuffer(values, dynamic = false) {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    return { buffer, count: values.length / 7 };
  }
  const bodyBuffer = makeBuffer(body);
  const traceBuffer = makeBuffer(traces);
  const backTraceBuffer = makeBuffer(backTraces);
  const rayBuffer = makeBuffer(rays);
  const nodeBuffer = makeBuffer(nodes);
  const backNodeBuffer = makeBuffer(backNodes);
  const activePaths = paths.filter((_, i) => i % 3 === 0);
  const pulseBuffer = makeBuffer(new Array(activePaths.length * 7).fill(0), true);

  const projection = new Float32Array(16);
  let pointScale = 1;
  function resize() {
    const width = Math.max(1, stage.clientWidth);
    const height = Math.max(1, stage.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    pointScale = canvas.height * 1.6;
    const near = .1, far = 100;
    const f = 1 / Math.tan(42 * Math.PI / 360);
    projection.fill(0);
    projection[0] = f / (canvas.width / canvas.height);
    projection[5] = f;
    projection[10] = -(far + near) / (far - near);
    projection[11] = -1;
    projection[14] = -(2 * far * near) / (far - near);
  }
  function draw(data, primitive, opacity, isPoint = false) {
    gl.bindBuffer(gl.ARRAY_BUFFER, data.buffer);
    const stride = 7 * 4;
    gl.vertexAttribPointer(attr.position, 3, gl.FLOAT, false, stride, 0);
    gl.vertexAttribPointer(attr.color, 3, gl.FLOAT, false, stride, 3 * 4);
    gl.vertexAttribPointer(attr.size, 1, gl.FLOAT, false, stride, 6 * 4);
    gl.enableVertexAttribArray(attr.position);
    gl.enableVertexAttribArray(attr.color);
    gl.enableVertexAttribArray(attr.size);
    gl.uniform1f(uni.opacity, opacity);
    gl.uniform1f(uni.pointMode, isPoint ? 1 : 0);
    gl.drawArrays(primitive, 0, data.count);
  }
  function positionOnPath(points, progress) {
    const scaled = progress * (points.length - 1);
    const index = Math.min(points.length - 2, Math.floor(scaled));
    const t = scaled - index;
    const a = points[index], b = points[index+1];
    return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t];
  }

  let targetYaw = -.34, targetPitch = .22;
  let currentYaw = targetYaw, currentPitch = targetPitch;
  let visible = true, frameId = 0, lastTime = 0;
  let dragging = false, autoRotate = true;
  let lastX = 0, lastY = 0;
  function render(time = 0) {
    const t = reducedMotion.matches ? 0 : time * .001;
    const delta = lastTime ? Math.min(.05, Math.max(0, (time - lastTime) * .001)) : 0;
    lastTime = time;
    if (autoRotate && !dragging && !reducedMotion.matches) targetYaw += delta * .42;
    if (reducedMotion.matches) {
      currentYaw = targetYaw;
      currentPitch = targetPitch;
    } else {
      currentYaw += (targetYaw - currentYaw) * .13;
      currentPitch += (targetPitch - currentPitch) * .13;
    }
    const yaw = currentYaw;
    const pitch = currentPitch;
    const roll = .38 + Math.sin(t * .16) * .025;

    gl.clearColor(0,0,0,0);
    gl.depthMask(true);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program);
    gl.uniformMatrix4fv(uni.projection, false, projection);
    gl.uniform3f(uni.rotation, pitch, yaw, roll);
    gl.uniform1f(uni.scale, pointScale);

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    draw(bodyBuffer, gl.TRIANGLES, 1);

    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    draw(traceBuffer, gl.TRIANGLES, .63);
    draw(backTraceBuffer, gl.TRIANGLES, .63);
    draw(rayBuffer, gl.LINES, .44);
    draw(nodeBuffer, gl.POINTS, .78, true);
    draw(backNodeBuffer, gl.POINTS, .78, true);

    const pulses = [];
    activePaths.forEach((points, index) => {
      const progress = (t * (.20 + index % 4 * .035) + index / activePaths.length) % 1;
      vertex(pulses, positionOnPath(points, progress), [.94,.98,1], .17);
    });
    gl.bindBuffer(gl.ARRAY_BUFFER, pulseBuffer.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(pulses));
    draw(pulseBuffer, gl.POINTS, 1, true);
    stage.classList.add('webgl-ready');
    hero.classList.add('chip-3d-ready');
  }
  function tick(time) {
    render(time);
    frameId = visible && !reducedMotion.matches ? requestAnimationFrame(tick) : 0;
  }
  function updateAnimation() {
    cancelAnimationFrame(frameId);
    frameId = 0;
    if (visible && !reducedMotion.matches) frameId = requestAnimationFrame(tick);
    else render(0);
  }

  if (gestureZone) {
    gestureZone.addEventListener('pointerdown', event => {
      dragging = true;
      autoRotate = false;
      lastX = event.clientX;
      lastY = event.clientY;
      gestureZone.setPointerCapture(event.pointerId);
      gestureZone.classList.add('dragging');
      event.preventDefault();
    });
    gestureZone.addEventListener('pointermove', event => {
      if (!dragging) return;
      targetYaw += (event.clientX - lastX) * .011;
      targetPitch += (event.clientY - lastY) * .011;
      lastX = event.clientX;
      lastY = event.clientY;
      if (reducedMotion.matches) render(0);
    });
    const stopDragging = () => {
      dragging = false;
      gestureZone.classList.remove('dragging');
    };
    gestureZone.addEventListener('pointerup', stopDragging);
    gestureZone.addEventListener('pointercancel', stopDragging);
    gestureZone.addEventListener('lostpointercapture', stopDragging);
    gestureZone.addEventListener('keydown', event => {
      const steps = { ArrowLeft: -.24, ArrowRight: .24, ArrowUp: -.24, ArrowDown: .24 };
      if (!(event.key in steps)) return;
      autoRotate = false;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') targetYaw += steps[event.key];
      else targetPitch += steps[event.key];
      if (reducedMotion.matches) render(0);
      event.preventDefault();
    });
  }
  reducedMotion.addEventListener('change', updateAnimation);
  new ResizeObserver(() => { resize(); if (!frameId) render(0); }).observe(stage);
  new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting && !document.hidden;
    updateAnimation();
  }, { threshold: 0 }).observe(hero);
  document.addEventListener('visibilitychange', () => {
    visible = !document.hidden && hero.getBoundingClientRect().bottom > 0;
    updateAnimation();
  });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    cancelAnimationFrame(frameId);
    stage.classList.remove('webgl-ready');
    hero.classList.remove('chip-3d-ready');
  });

  resize();
  render(0);
  updateAnimation();
})();

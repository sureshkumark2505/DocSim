(async function hyperspeedInit() {
  const hyperspeedPresets = {
    one: {
      canvasStarCount: 760,
      threeStarCount: 1400,
      starRadius: 26,
      depth: 900,
      speedMin: 0.6,
      speedMax: 1.6,
      colorHex: 0xcfd6e6,
      pointSize: 0.105,
      opacity: 0.82
    }
  };

  const effectOptions = hyperspeedPresets.one;

  const mount = document.getElementById("hyperspeed-canvas");
  const pagesMount = document.getElementById("bookPages");
  const runeStream = document.getElementById("rune-stream");
  if (!mount) {
    return;
  }

  function initRuneStream() {
    if (!runeStream) {
      return;
    }

    const glyphs = ["A", "R", "C", "N", "E", "Q", "X", "Z", "M", "K", "V", "L", "D", "Y", "*"];

    function spawnRune() {
      const rune = document.createElement("span");
      rune.className = "rune";
      rune.textContent = glyphs[Math.floor(Math.random() * glyphs.length)];
      rune.style.right = `${8 + Math.random() * 28}vw`;
      rune.style.bottom = `${10 + Math.random() * 8}vh`;
      rune.style.fontSize = `${12 + Math.random() * 20}px`;
      rune.style.setProperty("--drift", `${-130 + Math.random() * 220}px`);
      rune.style.setProperty("--dur", `${2.8 + Math.random() * 2.3}s`);
      runeStream.appendChild(rune);
      rune.addEventListener("animationend", () => rune.remove());
    }

    for (let i = 0; i < 12; i += 1) {
      window.setTimeout(spawnRune, i * 140);
    }

    window.setInterval(() => {
      if (runeStream.childElementCount > 50) {
        return;
      }
      spawnRune();
    }, 420);
  }

  function initBookPages() {
    if (!pagesMount) {
      return;
    }

    const pageCount = 14;
    pagesMount.innerHTML = "";

    for (let i = 0; i < pageCount; i += 1) {
      const page = document.createElement("div");
      page.className = "page";
      page.dataset.index = String(i);
      page.style.transform = `rotateY(${(-32 + i * 4.9).toFixed(2)}deg) translateZ(${(i * 1.6).toFixed(2)}px)`;
      page.style.opacity = String(Math.max(0.26, 0.92 - i * 0.045));
      pagesMount.appendChild(page);
    }

    let tick = 0;
    function animatePages() {
      tick += 0.025;
      const pageElements = pagesMount.querySelectorAll(".page");
      pageElements.forEach((page, index) => {
        const base = -32 + index * 4.9;
        const wave = Math.sin(tick + index * 0.38) * 2.2;
        page.style.transform = `rotateY(${(base + wave).toFixed(2)}deg) translateZ(${(index * 1.6).toFixed(2)}px)`;
      });
      requestAnimationFrame(animatePages);
    }

    animatePages();
  }

  function initCanvasFallback() {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    mount.appendChild(canvas);

    const stars = [];
    const starCount = effectOptions.canvasStarCount;

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }

    function resetStar(star, fresh = false) {
      star.x = (Math.random() - 0.5) * 2;
      star.y = (Math.random() - 0.5) * 2;
      star.z = fresh ? Math.random() : 1 + Math.random() * 3;
      star.speed = 0.008 + Math.random() * 0.018;
    }

    for (let i = 0; i < starCount; i += 1) {
      const star = {};
      resetStar(star, true);
      stars.push(star);
    }

    function render() {
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "rgba(2,2,5,0.2)";
      ctx.fillRect(0, 0, width, height);

      for (const star of stars) {
        star.z -= star.speed;
        if (star.z <= 0.01) {
          resetStar(star, false);
        }

        const sx = (star.x / star.z) * width * 0.52 + width / 2;
        const sy = (star.y / star.z) * height * 0.52 + height / 2;
        const radius = Math.max(0.35, (1 - star.z / 3.5) * 3.4);

        if (sx < 0 || sx > width || sy < 0 || sy > height) {
          resetStar(star, false);
          continue;
        }

        const tailX = (star.x / (star.z + 0.045)) * width * 0.52 + width / 2;
        const tailY = (star.y / (star.z + 0.045)) * height * 0.52 + height / 2;

        ctx.strokeStyle = "rgba(204,214,228,0.45)";
        ctx.lineWidth = radius * 1.12;
        ctx.beginPath();
        ctx.moveTo(tailX, tailY);
        ctx.lineTo(sx, sy);
        ctx.stroke();

        ctx.fillStyle = "rgba(236,242,249,0.96)";
        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      requestAnimationFrame(render);
    }

    resize();
    window.addEventListener("resize", resize);
    render();
  }

  function initThree(THREE) {
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x07090d, 0.04);

    const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 1200);
    camera.position.z = 6;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    mount.appendChild(renderer.domElement);

    const starCount = effectOptions.threeStarCount;
    const radius = effectOptions.starRadius;
    const depth = effectOptions.depth;
    const positions = new Float32Array(starCount * 3);
    const velocities = new Float32Array(starCount);

    for (let i = 0; i < starCount; i += 1) {
      const i3 = i * 3;
      const angle = Math.random() * Math.PI * 2;
      const spread = Math.pow(Math.random(), 0.58) * radius;
      positions[i3] = Math.cos(angle) * spread;
      positions[i3 + 1] = Math.sin(angle) * spread;
      positions[i3 + 2] = -Math.random() * depth;
      velocities[i] = effectOptions.speedMin + Math.random() * effectOptions.speedMax;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const pointsMaterial = new THREE.PointsMaterial({
      color: effectOptions.colorHex,
      size: effectOptions.pointSize,
      transparent: true,
      opacity: effectOptions.opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const points = new THREE.Points(geometry, pointsMaterial);
    scene.add(points);

    const clock = new THREE.Clock();

    function animate() {
      const dt = Math.min(clock.getDelta(), 0.06);
      const positionArray = geometry.attributes.position.array;

      for (let i = 0; i < starCount; i += 1) {
        const zIndex = i * 3 + 2;
        positionArray[zIndex] += velocities[i] * dt * 98;

        if (positionArray[zIndex] > 18) {
          positionArray[zIndex] = -depth;
        }
      }

      geometry.attributes.position.needsUpdate = true;

      points.rotation.z += dt * 0.03;
      camera.position.x = Math.sin(performance.now() * 0.00012) * 0.28;
      camera.position.y = Math.cos(performance.now() * 0.00016) * 0.24;
      camera.lookAt(0, 0, -120);

      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    }

    function handleResize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    }

    window.addEventListener("resize", handleResize);
    animate();
  }

  try {
    const module = await import("/vendor/three.module.min.js");
    initBookPages();
    initRuneStream();
    initThree(module);
  } catch (error) {
    console.warn("Three.js unavailable, using fallback animation.", error);
    initBookPages();
    initRuneStream();
    initCanvasFallback();
  }
})();

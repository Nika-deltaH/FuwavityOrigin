const { Engine, Render, Runner, World, Bodies, Body, Events, Composite, Vector, Detector } = Matter;

// Configuration
const GAME_W = 380;           // Canvas width
const GAME_H = 680;           // Canvas height

// Layout (all Y values are canvas-space, top = 0)
const UI_HEIGHT = 50;     // Top UI bar (score / next)
const GAMEOVER_Y = 170;     // Game over line (invisible, = UI_HEIGHT)
const WARNING_LINE_Y = 190;    // Static gray line, always visible (10px below gameover)
const WARNING_TRIGGER_Y = 205;  // Triggers warning flag (15px below gray line)
const FIELD_TOP = WARNING_LINE_Y;     // Same as WARNING_LINE_Y
const FIELD_BOTTOM = 600;    // Bottom wall inner face
const FIELD_LEFT = 40;     // Left wall inner face
const FIELD_RIGHT = 340;    // Right wall inner face  (350px wide field)
const DROP_Y = 140;     // Preview ball Y (above gameover line, inside UI area)
const WALL_THICKNESS = 30;

// Sizes: 25, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130 (Diameters)
// Radii: 12.5, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65
const BALL_RADII = [15, 20, 25, 30, 35, 40, 45, 52, 61, 72, 85, 100];

// Placeholder Colors
const BALL_COLORS = [
    '#FF3333', '#FF9933', '#FFFF33', '#33FF33', '#33FFFF',
    '#3333FF', '#9933FF', '#FF33FF', '#FFFFFF', '#000000',
    '#FF5733', '#33FF57'
];

// --- IMAGE REPLACEMENT CONFIGURATION ---
// To use images:
// 1. Put images named 001.PNG... 012.PNG in the 'assets' folder.
// 2. Set USE_IMAGES = true;
const USE_IMAGES = true;
// ---------------------------------------

let engine;
let render;
let runner;
let score = 0;
let isGameOver = false;
let isPlaying = false;
let isWarningActive = false;
let gameOverCounter = 0;
const GAMEOVER_THRESHOLD = 30; // 0.5 seconds at 60fps

// Upcoming queue
let upcomingLevels = [];

// The ball currently hovering at top, waiting to be dropped
let previewBall = null;
let spawnTimeoutId = null;
let dropX = (FIELD_LEFT + FIELD_RIGHT) / 2; // horizontal center of play field

// Elements
const scoreEl = document.getElementById('score'); // Live Score
const finalScoreEl = document.getElementById('final-score');
const gameHeader = document.getElementById('game-header');
const gameFooter = document.getElementById('game-footer');
const retryBtn = document.getElementById('retry-btn');
const retryBtnTop = document.getElementById('retry-btn-top');
const shareBtn = document.getElementById('share-btn');
const screenshotBtn = document.getElementById('screenshot-btn');
const mainWrapper = document.getElementById('main-wrapper');
const uiLayer = document.getElementById('ui-layer'); // In-Game UI
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('close-settings');
const bgmSlider = document.getElementById('bgm-volume');
const sfxSlider = document.getElementById('sfx-volume');
const loadingScreen = document.getElementById('loading-screen');
const loadingProgress = document.getElementById('loading-progress');

// Audio
const bgm = new Audio('assets/bgm.mp3');
bgm.loop = true;
const clickSound = new Audio('assets/click.mp3');
const mergeSound = new Audio('assets/merge.mp3');

// Asset Lists
const IMAGES_TO_LOAD = [
    'assets/001.PNG', 'assets/002.PNG', 'assets/003.PNG', 'assets/004.PNG',
    'assets/005.PNG', 'assets/006.PNG', 'assets/007.PNG', 'assets/008.PNG',
    'assets/009.PNG', 'assets/010.PNG', 'assets/011.PNG', 'assets/012.PNG'
];
const ASSET_IMAGES = {}; // Cache for preloaded images

// Audio Init Volume
let bgmVolume = 0.5;
let sfxVolume = 1.0;

bgm.volume = bgmVolume;
clickSound.volume = sfxVolume;
mergeSound.volume = sfxVolume;

async function preloadAssets() {
    let loadedCount = 0;
    const totalAssets = IMAGES_TO_LOAD.length; // Intentionally only tracking images for visual loading bar
    // Audio preloading is less visual, but we can try to fetch them too.

    const updateProgress = () => {
        loadedCount++;
        const percent = Math.floor((loadedCount / totalAssets) * 100);
        if (loadingProgress) loadingProgress.textContent = percent + '%';
        if (loadedCount >= totalAssets) {
            setTimeout(() => {
                loadingScreen.style.display = 'none';
                init();
            }, 500); // Small delay for smoothness
        }
    };

    IMAGES_TO_LOAD.forEach(src => {
        const img = new Image();
        img.onload = () => {
            // Extract simple filename key (e.g., '001')
            const key = src.split('/').pop().split('.')[0];
            ASSET_IMAGES[key] = img;
            updateProgress();
        };
        img.onerror = (e) => {
            console.error('Failed to load image:', src, e);
            updateProgress(); // Continue anyway to avoid hanging
        };
        img.src = src;
    });
}

function makeWalls() {
    const opts = { isStatic: true, render: { fillStyle: 'transparent' } };
    const cx = (FIELD_LEFT + FIELD_RIGHT) / 2; // horizontal center of field
    return [
        // Bottom
        Bodies.rectangle(cx, FIELD_BOTTOM + WALL_THICKNESS / 2, FIELD_RIGHT - FIELD_LEFT, WALL_THICKNESS, opts),
        // Left
        Bodies.rectangle(FIELD_LEFT - WALL_THICKNESS / 2, GAME_H / 2, WALL_THICKNESS, GAME_H * 2, opts),
        // Right
        Bodies.rectangle(FIELD_RIGHT + WALL_THICKNESS / 2, GAME_H / 2, WALL_THICKNESS, GAME_H * 2, opts),
    ];
}

function init() {
    // Create Engine
    engine = Engine.create({
        positionIterations: 6,
        velocityIterations: 4
    });
    engine.world.gravity.y = 1.5; // Downward gravity

    // Create Renderer
    render = Render.create({
        element: document.getElementById('game-container'),
        engine: engine,
        options: {
            width: GAME_W,
            height: GAME_H,
            wireframes: false,
            background: 'transparent',
            pixelRatio: Math.min(window.devicePixelRatio, 2)
        }
    });

    // Create Walls (left, right, bottom) — aligned to play field
    const wallOpts = { isStatic: true, render: { fillStyle: 'transparent' } };
    World.add(engine.world, makeWalls());

    // Create Runner
    runner = Runner.create();
    Runner.run(runner, engine);
    Render.run(render);

    // Initial message
    showStartMessage();

    // Ensure Init State: Header/Footer hidden, UI shown (but msg covers it)
    gameHeader.classList.add('hidden');
    gameFooter.classList.add('hidden');
    uiLayer.classList.remove('hidden');

    // Custom Rendering
    Events.on(render, 'afterRender', () => {
        const ctx = render.context;

        // 1. Play field border (always)
        ctx.beginPath();
        ctx.rect(FIELD_LEFT, FIELD_TOP, FIELD_RIGHT - FIELD_LEFT, FIELD_BOTTOM - FIELD_TOP);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // 2. Warning dashed line (Only visible when active)
        if (isWarningActive && !isGameOver) {
            ctx.beginPath();
            ctx.moveTo(FIELD_LEFT, WARNING_LINE_Y);
            ctx.lineTo(FIELD_RIGHT, WARNING_LINE_Y);
            ctx.setLineDash([12, 10]); // Thick dashed line
            ctx.strokeStyle = '#FF3333';
            ctx.lineWidth = 4; // Thicker
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // 3. Drop guide line (vertical dashed, from preview ball to bottom)
        if (previewBall && isPlaying) {
            ctx.beginPath();
            ctx.moveTo(previewBall.x, previewBall.y + previewBall.radius + 2);
            ctx.lineTo(previewBall.x, FIELD_BOTTOM);
            ctx.setLineDash([6, 8]);
            ctx.strokeStyle = 'rgba(255,255,255,0.2)';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // 5. Preview Ball
        if (previewBall && isPlaying) {
            if (USE_IMAGES) {
                const imageIndex = String(previewBall.level + 1).padStart(3, '0');
                if (ASSET_IMAGES[imageIndex]) {
                    const img = ASSET_IMAGES[imageIndex];
                    const size = previewBall.radius * 2;
                    ctx.save();
                    ctx.translate(previewBall.x, previewBall.y);
                    ctx.drawImage(img, -previewBall.radius, -previewBall.radius, size, size);
                    ctx.restore();
                } else {
                    ctx.beginPath();
                    ctx.arc(previewBall.x, previewBall.y, previewBall.radius, 0, 2 * Math.PI);
                    ctx.fillStyle = previewBall.color;
                    ctx.fill();
                }
            } else {
                ctx.beginPath();
                ctx.arc(previewBall.x, previewBall.y, previewBall.radius, 0, 2 * Math.PI);
                ctx.fillStyle = previewBall.color;
                ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }
    });

    // Physics Loop Updates
    Events.on(engine, 'beforeUpdate', () => {
        if (isGameOver) return;

        let warningTriggered = false;
        let gameOverTriggered = false;
        const bodies = Composite.allBodies(engine.world);

        bodies.forEach(body => {
            if (body.isStatic) return;

            const topEdge = body.position.y - body.circleRadius;

            // Warning Check: top edge above WARNING_TRIGGER_Y
            if (topEdge < WARNING_TRIGGER_Y) {
                if (body.id !== (lastShotBodyId || -1)) {
                    warningTriggered = true;
                } else if (body.speed < 2) {
                    warningTriggered = true;
                }
            }

            // Game Over Check: top edge above GAMEOVER_Y and nearly stopped
            if (topEdge < GAMEOVER_Y) {
                if (body.speed < 0.5 && body.id !== (lastShotBodyId || -1)) {
                    gameOverTriggered = true;
                }
            }

            // Pop Animation
            if (body.isPopping) {
                const targetRadius = BALL_RADII[body.level];
                if (body.circleRadius > targetRadius + 0.5) {
                    Body.scale(body, 0.95, 0.95);
                } else {
                    body.isPopping = false;
                }
            }
        });

        isWarningActive = warningTriggered;

        // Game Over logic with delay
        if (gameOverTriggered) {
            gameOverCounter++;
            if (gameOverCounter >= GAMEOVER_THRESHOLD) {
                endGame();
            }
        } else {
            gameOverCounter = 0;
        }
    });

    // Collision & Merge Logic
    Events.on(engine, 'collisionStart', (event) => {
        const pairs = event.pairs;
        for (let i = 0; i < pairs.length; i++) {
            const bodyA = pairs[i].bodyA;
            const bodyB = pairs[i].bodyB;

            if (bodyA.level !== undefined && bodyB.level !== undefined) {
                if (bodyA.level === bodyB.level && bodyA.level < 11) { // 12 levels (0-11)
                    mergeBalls(bodyA, bodyB);
                }
            }
        }
    });

    // Track mouse/touch X for drop position preview
    const container = document.getElementById('game-container');

    function getGameX(e) {
        const rect = render.canvas.getBoundingClientRect();
        const scaleX = GAME_W / rect.width;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        // Clamp to play field X range (accounting for ball radius later in shoot)
        return Math.max(FIELD_LEFT, Math.min(FIELD_RIGHT, (clientX - rect.left) * scaleX));
    }

    container.addEventListener('mousemove', (e) => {
        if (!isPlaying || isGameOver || !previewBall) return;
        dropX = getGameX(e);
        previewBall.x = dropX;
    });
    container.addEventListener('touchmove', (e) => {
        if (!isPlaying || isGameOver || !previewBall) return;
        e.preventDefault();
        dropX = getGameX(e);
        previewBall.x = dropX;
    }, { passive: false });

    container.addEventListener('mousedown', handleInput);
    container.addEventListener('touchstart', handleInput, { passive: false });

    spawnPreview();
}

let lastShotBodyId = null;

function handleInput(e) {
    if (e.target.tagName === 'BUTTON' || e.target.parentElement.tagName === 'BUTTON') return;
    if (e.type === 'touchstart') e.preventDefault();
    if (isGameOver) return;

    if (!isPlaying) {
        isPlaying = true;
        const msg = document.getElementById('start-message');
        if (msg) msg.style.display = 'none';

        // Show the next ball preview once game starts
        updateNextPreviewUI();

        // Try play BGM on first interaction
        if (bgm.paused && bgm.volume > 0) {
            bgm.play().catch(e => console.log("BGM waiting for interaction"));
        }
    }

    // Update drop X from the click/touch position
    if (render && render.canvas) {
        const rect = render.canvas.getBoundingClientRect();
        const scaleX = GAME_W / rect.width;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        dropX = Math.max(0, Math.min(GAME_W, (clientX - rect.left) * scaleX));
        if (previewBall) previewBall.x = dropX;
    }

    shoot();
}

function showStartMessage() {
    const existingMsg = document.getElementById('start-message');
    if (existingMsg) existingMsg.remove();

    const msg = document.createElement('div');
    msg.id = 'start-message';
    msg.innerHTML = "<h1>Tap Anywhere<br>to Start</h1>";
    msg.style.position = 'absolute';
    msg.style.top = '50%';
    msg.style.left = '50%';
    msg.style.transform = 'translate(-50%, -50%)';
    msg.style.textAlign = 'center';
    msg.style.width = '100%';
    msg.style.color = 'white';
    msg.style.fontSize = '30px';
    msg.style.pointerEvents = 'none';
    msg.style.textShadow = '0 0 10px black';
    msg.style.zIndex = '5';
    document.getElementById('game-container').appendChild(msg);
}

function spawnPreview() {
    if (upcomingLevels.length < 1) {
        upcomingLevels.push(Math.floor(Math.random() * 4));
    }

    const level = upcomingLevels.shift();
    upcomingLevels.push(Math.floor(Math.random() * 4));

    const radius = BALL_RADII[level];
    const color = BALL_COLORS[level];

    previewBall = {
        level: level,
        radius: radius,
        color: color,
        x: dropX,   // stay at last known drop X
        y: DROP_Y
    };

    updateNextPreviewUI();
}

function updateNextPreviewUI() {
    const slot1 = document.getElementById('next-ball-1');
    if (!slot1) return;

    // 遊戲尚未開始前，因為軌道上還沒有球，所以「Next」預覽顯示為第一顆即將出現的球（previewBall）
    // 遊戲開始後軌道上已經有球了，所以「Next」顯示為再下一顆即將出現的球（upcomingLevels[0]）
    let lvl = upcomingLevels[0];
    if (!isPlaying && previewBall) {
        lvl = previewBall.level;
    }

    if (USE_IMAGES) {
        slot1.style.backgroundImage = `url('assets/${String(lvl + 1).padStart(3, '0')}.PNG')`;
        slot1.style.backgroundColor = 'transparent';
    } else {
        slot1.style.backgroundImage = 'none';
        slot1.style.backgroundColor = BALL_COLORS[lvl];
    }
}

function shoot() {
    if (!previewBall || isGameOver) return;

    const renderConfig = USE_IMAGES ? {
        sprite: {
            texture: `assets/${String(previewBall.level + 1).padStart(3, '0')}.PNG`,
            xScale: (previewBall.radius * 2) / 250,
            yScale: (previewBall.radius * 2) / 250
        }
    } : {
        fillStyle: previewBall.color
    };

    // Clamp spawn X inside play field
    const spawnX = Math.max(FIELD_LEFT + previewBall.radius, Math.min(FIELD_RIGHT - previewBall.radius, previewBall.x));

    const body = Bodies.circle(spawnX, DROP_Y, previewBall.radius, {
        restitution: 0.4,
        friction: 0.05,
        frictionAir: 0.01,
        render: renderConfig
    });

    body.level = previewBall.level;
    lastShotBodyId = body.id;

    // Drop straight down
    Body.setVelocity(body, { x: 0, y: 5 });

    playSound(clickSound);
    World.add(engine.world, body);

    if (spawnTimeoutId) clearTimeout(spawnTimeoutId);
    previewBall = null;
    spawnTimeoutId = setTimeout(spawnPreview, 600);
}

function mergeBalls(bodyA, bodyB) {
    if (bodyA.isRemoved || bodyB.isRemoved) return;
    bodyA.isRemoved = true;
    bodyB.isRemoved = true;

    const midX = (bodyA.position.x + bodyB.position.x) / 2;
    const midY = (bodyA.position.y + bodyB.position.y) / 2;
    const newLevel = bodyA.level + 1;

    World.remove(engine.world, [bodyA, bodyB]);

    score += (newLevel + 1) * 10;
    scoreEl.textContent = score;

    // Play Merge Sound
    playSound(mergeSound);

    const radius = BALL_RADII[newLevel];

    const renderConfig = USE_IMAGES ? {
        sprite: {
            texture: `assets/${String(newLevel + 1).padStart(3, '0')}.PNG`,
            xScale: (radius * 2) / 250, // Source: 250px
            yScale: (radius * 2) / 250
        }
    } : {
        fillStyle: BALL_COLORS[newLevel]
    };

    const newBody = Bodies.circle(midX, midY, radius, {
        restitution: 0.3,
        friction: 0.05,
        frictionAir: 0.02,
        render: renderConfig
    });
    newBody.level = newLevel;
    Body.setVelocity(newBody, { x: (Math.random() - 0.5), y: (Math.random() - 0.5) });

    // Pop Animation
    Body.scale(newBody, 1.1, 1.1);
    newBody.isPopping = true;

    World.add(engine.world, newBody);
}

function endGame() {
    if (isGameOver) return;
    isGameOver = true;
    finalScoreEl.textContent = score;
    // Show Header and Footer, Hide In-Game UI
    gameHeader.classList.remove('hidden');
    gameFooter.classList.remove('hidden');
    uiLayer.classList.add('hidden');
}

function resetGame() {
    if (spawnTimeoutId) {
        clearTimeout(spawnTimeoutId);
        spawnTimeoutId = null;
    }

    World.clear(engine.world);
    Engine.clear(engine);

    World.add(engine.world, makeWalls());

    score = 0;
    scoreEl.textContent = '0';
    isGameOver = false;
    isWarningActive = false;
    gameOverCounter = 0;
    upcomingLevels = [];
    previewBall = null;
    dropX = (FIELD_LEFT + FIELD_RIGHT) / 2; // center of play field
    gameHeader.classList.add('hidden');
    gameFooter.classList.add('hidden');
    uiLayer.classList.remove('hidden');
    isPlaying = false;
    showStartMessage();
    spawnPreview();
}

// Helper to play SFX (clone node to allow overlapping)
function playSound(audio) {
    if (audio.volume > 0) {
        const clone = audio.cloneNode();
        clone.volume = audio.volume;
        clone.play().catch(e => console.warn('Audio play failed', e));
    }
}

// Global UI Handlers
if (retryBtnTop) retryBtnTop.addEventListener('click', resetGame);
if (retryBtn) retryBtn.addEventListener('click', resetGame);

// Settings UI Handlers
if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
        settingsModal.classList.remove('hidden');
        settingsModal.style.display = 'flex';
        // Pause game? Maybe not, keep it flowing
    });
}

if (closeSettingsBtn) {
    closeSettingsBtn.addEventListener('click', () => {
        settingsModal.classList.add('hidden');
        settingsModal.style.display = 'none';

        // Ensure BGM starts if it wasn't playing (user interaction)
        if (bgm.paused && bgm.volume > 0) {
            bgm.play().catch(e => console.warn("BGM autoplay prevented", e));
        }
    });
}

bgmSlider.addEventListener('input', (e) => {
    bgmVolume = e.target.value / 100;
    bgm.volume = bgmVolume;
    if (bgmVolume > 0 && bgm.paused) {
        bgm.play().catch(e => console.warn("BGM play failed", e));
    }
});

sfxSlider.addEventListener('input', (e) => {
    sfxVolume = e.target.value / 100;
    clickSound.volume = sfxVolume;
    mergeSound.volume = sfxVolume;
});

// Handle tab switching / app backgrounding
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        bgm.pause();
    } else {
        // Resume BGM if it should be playing (game started and not muted)
        if (isPlaying && bgmVolume > 0) {
            bgm.play().catch(e => console.warn("BGM resume failed", e));
        }
    }
});


if (screenshotBtn) {
    screenshotBtn.addEventListener('click', () => {
        // Manual Screenshot Composition
        // 1. Create a temporary canvas
        const captureCanvas = document.createElement('canvas');
        const gameCanvas = document.querySelector('#game-container canvas'); // Matter.js canvas

        if (!gameCanvas) {
            alert('Game canvas not found!');
            return;
        }

        captureCanvas.width = gameCanvas.width;
        captureCanvas.height = gameCanvas.height + 150; // Extra height for Header/Footer info
        const ctx = captureCanvas.getContext('2d');

        // 2. Fill Background
        ctx.fillStyle = '#222';
        ctx.fillRect(0, 0, captureCanvas.width, captureCanvas.height);

        // 3. Draw Header Info manually (Since we can't capture HTML easily without html2canvas issues)
        // Center the content vertically/horizontally
        const centerX = captureCanvas.width / 2;

        ctx.fillStyle = '#ff4444';
        ctx.font = 'bold 48px Arial';
        ctx.textAlign = 'center';
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'white';
        ctx.strokeText('Game Over', centerX, 60);
        ctx.fillText('Game Over', centerX, 60);

        ctx.fillStyle = 'white';
        ctx.font = 'bold 36px Arial';
        ctx.fillText('Score: ' + score, centerX, 110);

        // 4. Draw Game Canvas
        // Position it below the header
        const gameY = 150;
        ctx.drawImage(gameCanvas, 0, gameY);

        // 5. Download
        try {
            const dataURL = captureCanvas.toDataURL('image/PNG');
            const link = document.createElement('a');
            link.download = `ComboGame_Score_${score}.PNG`;
            link.href = dataURL;
            link.click();
        } catch (err) {
            console.error(err);
            alert('Screenshot failed. If you are running locally (file://), browsers verify security. Please try on a local server or GitHub Pages.');
        }
    });
}

if (shareBtn) {
    shareBtn.addEventListener('click', () => {
        const url = "https://nikaworx.com/FuwavityOrigin/";
        const msg = `I scored ${score} in FuwavityOrigin! Can you beat me?`;

        if (navigator.share) {
            navigator.share({
                title: 'FuwavityOrigin',
                text: msg,
                url: url
            }).catch(err => console.error("Share failed", err));
        } else {
            navigator.clipboard.writeText(`${msg} ${url}`);
            alert('Copied to clipboard!');
        }
    });
}

// Start
// init(); // Removed, called by preloadAssets
preloadAssets();

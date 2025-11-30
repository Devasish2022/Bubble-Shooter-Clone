// ====================== CORE CONSTANTS & DOM REFERENCES ======================

// Canvas & context
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// HUD elements
const restartBtn = document.getElementById("restartBtn");
const pauseBtn = document.getElementById("pauseBtn");
const levelText = document.getElementById("levelText");
const scoreText = document.getElementById("scoreText");
const shotsText = document.getElementById("shotsText");
const highScoreText = document.getElementById("highScoreText");

// Overlays (main menu + pause)
const menuOverlay = document.getElementById("menuOverlay");
const menuStartBtn = document.getElementById("menuStartBtn");
const menuContinueBtn = document.getElementById("menuContinueBtn");
const menuHighScore = document.getElementById("menuHighScore");

const pauseOverlay = document.getElementById("pauseOverlay");
const pauseResumeBtn = document.getElementById("pauseResumeBtn");
const pauseRestartBtn = document.getElementById("pauseRestartBtn");
const pauseMenuBtn = document.getElementById("pauseMenuBtn");

// Canvas size
const WIDTH = canvas.width;
const HEIGHT = canvas.height;

// Bubble geometry + speed
const BUBBLE_RADIUS = 16;
const SHOOTER_Y = HEIGHT - 60;
const BUBBLE_SPEED = 8;

// Available bubble colors (some are locked until higher levels)
const BASE_COLORS = ["#ff595e", "#ffca3a", "#8ac926", "#1982c4", "#6a4c93"];

// ====================== GAME STATE MODEL ======================

// Simple finite state machine for the game
const GameState = {
    MENU: "menu",
    PLAYING: "playing",
    PAUSED: "paused",
    GAMEOVER: "gameover"
};

let gameState = GameState.MENU;

// World entities
let bubbles = [];            // all static bubbles on the board
let currentBubble = null;    // bubble that is currently loaded in the cannon
let nextBubbleColor = null;  // preview color

// Aiming system
// aimDir is the ONLY source of truth for direction.
// The cannon rotation, trajectory preview, and shot velocity all use this.
let aimPoint = { x: WIDTH / 2, y: HEIGHT / 2 };
let aimDir = { x: 0, y: -1 };
let isAiming = false;

// Scoring & progression
let shotCount = 0;
let score = 0;
let level = 1;

// High score in localStorage (persists between sessions)
let highScore = 0;
const HS_KEY = "bubbleShooterHighScore_v1";

// Matching / neighbor logic (for flood fill & cluster detection)
const NEIGHBOR_DISTANCE = BUBBLE_RADIUS * 2.3;
const NEIGHBOR_DIST_SQ = NEIGHBOR_DISTANCE * NEIGHBOR_DISTANCE;

// Trajectory preview points (for bounce path rendering)
let previewPath = [];
const TRAJECTORY_STEP = 8;
const MAX_TRAJECTORY_STEPS = 1200;

// ====================== SOUND: SIMPLE WEB AUDIO BEEPS ======================

let audioCtx = null;

/**
 * Lazily create the AudioContext on first user interaction.
 * This avoids browser restrictions on autoplay audio.
 */
function initAudio() {
    if (!audioCtx) {
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            audioCtx = null;
        }
    }
}

/**
 * Fire a simple procedural sound using an oscillator.
 * Good enough for shoot / pop / UI feedback without loading assets.
 */
function playBeep(freq = 440, duration = 0.08, type = "sine", volume = 0.15) {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = volume;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const now = audioCtx.currentTime;
    osc.start(now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.stop(now + duration + 0.02);
}

function playShootSound() {
    playBeep(900, 0.05, "square", 0.12);
}

function playPopSound(count = 3) {
    // Slightly randomized pops to avoid sounding too robotic
    for (let i = 0; i < Math.min(count, 5); i++) {
        setTimeout(() => {
            playBeep(400 + Math.random() * 200, 0.06, "triangle", 0.12);
        }, i * 30);
    }
}

function playFallSound(count = 2) {
    playBeep(220, 0.08, "sawtooth", 0.12);
    if (count > 2) {
        setTimeout(() => playBeep(180, 0.1, "sawtooth", 0.12), 60);
    }
}

function playWinSound() {
    const freqs = [660, 880, 1040];
    freqs.forEach((f, i) =>
        setTimeout(() => playBeep(f, 0.12, "square", 0.2), i * 140)
    );
}

function playLoseSound() {
    playBeep(260, 0.15, "sawtooth", 0.18);
    setTimeout(() => playBeep(180, 0.18, "sawtooth", 0.18), 120);
}

// ====================== HUD & HIGHSCORE ======================

function loadHighScore() {
    try {
        const v = parseInt(localStorage.getItem(HS_KEY));
        if (!isNaN(v)) highScore = v;
    } catch {
        // ignore storage error
    }
}

function saveHighScore() {
    try {
        localStorage.setItem(HS_KEY, highScore);
    } catch {
        // ignore storage error
    }
}

/** Called after scoring events to push new best into localStorage. */
function maybeUpdateHighScore() {
    if (score > highScore) {
        highScore = score;
        saveHighScore();
        updateHUD();
    }
}

/** Color pool expands as level increases. */
function randColorForLevel() {
    const maxIdx = Math.min(BASE_COLORS.length, 3 + level);
    return BASE_COLORS[Math.floor(Math.random() * maxIdx)];
}

function updateHUD() {
    levelText.textContent = `Lvl ${level}`;
    scoreText.textContent = `Score: ${score}`;
    shotsText.textContent = `Shots: ${shotCount}`;
    highScoreText.textContent = `Best: ${highScore}`;
    menuHighScore.textContent = `Best: ${highScore}`;
}

// ====================== GRID INITIALIZATION ======================

/**
 * Creates an initial "ceiling" of bubbles in staggered rows.
 * Rows increase with level to scale difficulty.
 */
function createInitialGrid() {
    bubbles = [];
    const rows = 4 + level; // L1: 5 rows, etc.
    const r = BUBBLE_RADIUS;

    for (let row = 0; row < rows; row++) {
        const isOffset = row % 2 === 1;
        const offset = isOffset ? r : 0;
        for (let x = r + offset; x <= WIDTH - r; x += 2 * r) {
            const y = r + row * (r * 1.75);
            bubbles.push({
                x,
                y,
                radius: r,
                color: randColorForLevel()
            });
        }
    }
}

/** Creates the bubble that sits in the cannon ready to fire. */
function spawnCurrentBubble() {
    const color = nextBubbleColor || randColorForLevel();
    currentBubble = {
        x: WIDTH / 2,
        y: SHOOTER_Y,
        radius: BUBBLE_RADIUS,
        color: color,
        dx: 0,
        dy: 0,
        moving: false
    };
    nextBubbleColor = randColorForLevel();
}

/** Reset just the level state, optionally also resetting the score/level. */
function resetLevel(resetScoreAndLevel = true) {
    if (resetScoreAndLevel) {
        score = 0;
        level = 1;
    }
    shotCount = 0;
    createInitialGrid();
    nextBubbleColor = randColorForLevel();
    spawnCurrentBubble();
    updateHUD();
}

/** Advance to the next level with more rows / colors. */
function nextLevel() {
    level++;
    shotCount = 0;
    createInitialGrid();
    nextBubbleColor = randColorForLevel();
    spawnCurrentBubble();
    updateHUD();
}

// ====================== OVERLAY HELPERS ======================

function showMenuOverlay(show) {
    if (show) menuOverlay.classList.add("visible");
    else menuOverlay.classList.remove("visible");
}

function showPauseOverlay(show) {
    if (show) pauseOverlay.classList.add("visible");
    else pauseOverlay.classList.remove("visible");
}

// ====================== INPUT & AIMING SYSTEM ======================

/**
 * Convert mouse / touch coordinates to canvas-space (0..WIDTH, 0..HEIGHT).
 */
function getCanvasPos(evt) {
    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;

    if (evt.touches && evt.touches.length > 0) {
        clientX = evt.touches[0].clientX;
        clientY = evt.touches[0].clientY;
    } else if (evt.changedTouches && evt.changedTouches.length > 0) {
        clientX = evt.changedTouches[0].clientX;
        clientY = evt.changedTouches[0].clientY;
    } else {
        clientX = evt.clientX;
        clientY = evt.clientY;
    }

    const x = ((clientX - rect.left) / rect.width) * WIDTH;
    const y = ((clientY - rect.top) / rect.height) * HEIGHT;
    return { x, y };
}

/**
 * Update aimDir from the pointer position.
 * - Direction is from shooter position to pointer.
 * - We clamp dy so you can't aim below the cannon.
 */
function updateAimDirection(pos) {
    const shooterX = WIDTH / 2;
    const shooterY = SHOOTER_Y;

    let dx = pos.x - shooterX;
    let dy = pos.y - shooterY;

    // Prevent aiming downward too much
    const minUp = -40;
    if (dy > minUp) dy = minUp;

    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    dx /= len;
    dy /= len;

    aimDir.x = dx;
    aimDir.y = dy;
    aimPoint = pos;
}

function startAim(evt) {
    if (gameState !== GameState.PLAYING) return;
    if (!currentBubble || currentBubble.moving) return;

    evt.preventDefault();
    initAudio();
    isAiming = true;
    const pos = getCanvasPos(evt);
    updateAimDirection(pos);
}

function moveAim(evt) {
    if (!isAiming) return;
    if (gameState !== GameState.PLAYING) return;

    evt.preventDefault();
    const pos = getCanvasPos(evt);
    updateAimDirection(pos);
}

/**
 * When the player releases touch/mouse:
 * - lock in aimDir as the shot direction
 * - give the currentBubble velocity based on that direction
 */
function shoot(evt) {
    if (!isAiming) return;
    if (gameState !== GameState.PLAYING) return;
    if (!currentBubble || currentBubble.moving) return;

    evt.preventDefault();
    isAiming = false;

    currentBubble.dx = aimDir.x * BUBBLE_SPEED;
    currentBubble.dy = aimDir.y * BUBBLE_SPEED;
    currentBubble.moving = true;
    shotCount++;
    updateHUD();
    playShootSound();
}

// Mouse
canvas.addEventListener("mousedown", startAim);
canvas.addEventListener("mousemove", moveAim);
canvas.addEventListener("mouseup", shoot);
canvas.addEventListener("mouseleave", () => (isAiming = false));

// Touch
canvas.addEventListener("touchstart", startAim, { passive: false });
canvas.addEventListener("touchmove", moveAim, { passive: false });
canvas.addEventListener("touchend", shoot, { passive: false });
canvas.addEventListener("touchcancel", () => (isAiming = false));

// Keyboard: quick pause toggle
window.addEventListener("keydown", (e) => {
    if (e.key === "p" || e.key === "P" || e.key === "Escape") {
        if (gameState === GameState.PLAYING) {
            pauseGame();
        } else if (gameState === GameState.PAUSED) {
            resumeGame();
        }
    }
});

// ====================== COLLISION, MATCHING & SNAPPING ======================

function distanceSq(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
}

/**
 * Try to snap the newly fired bubble into one of the "hex" neighbors around
 * the bubble it collided with.
 *
 * This makes it slide nicely into gaps between bubbles instead of sticking
 * in awkward overlapping positions.
 */
function findSnapPosition(collided, movingBubble) {
    const candidates = [];
    const r2 = BUBBLE_RADIUS * 2;

    // 6 neighbor positions around the hexagon
    for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i;
        const x = collided.x + Math.cos(angle) * r2;
        const y = collided.y + Math.sin(angle) * r2;
        candidates.push({ x, y });
    }

    let best = null;
    const minDistFromTop = BUBBLE_RADIUS;

    for (const pos of candidates) {
        if (pos.x < BUBBLE_RADIUS || pos.x > WIDTH - BUBBLE_RADIUS) continue;
        if (pos.y < minDistFromTop) continue;

        // Reject positions that overlap existing bubbles
        let overlap = false;
        for (const b of bubbles) {
            if (b === collided) continue;
            const minDist = (BUBBLE_RADIUS * 2) - 2;
            if (distanceSq(pos, b) < minDist * minDist) {
                overlap = true;
                break;
            }
        }
        if (overlap) continue;

        // Choose the snap spot closest to the collision point
        const distToMoving =
            (pos.x - movingBubble.x) ** 2 + (pos.y - movingBubble.y) ** 2;
        if (!best || distToMoving < best.dist) {
            best = { pos, dist: distToMoving };
        }
    }

    return best ? best.pos : null;
}

/**
 * Standard flood fill to find a connected region of bubbles
 * that share the same color as the starting bubble.
 *
 * This is used to:
 * 1. Remove groups of >= 3 same-color bubbles.
 * 2. Calculate scoring for pop events.
 */
function floodFillColor(start) {
    const visited = new Set();
    const result = [];
    const queue = [];

    queue.push(start);
    visited.add(start);

    while (queue.length > 0) {
        const b = queue.shift();
        result.push(b);
        for (const other of bubbles) {
            if (visited.has(other)) continue;
            if (other.color !== start.color) continue;
            if (distanceSq(b, other) <= NEIGHBOR_DIST_SQ) {
                visited.add(other);
                queue.push(other);
            }
        }
    }

    return result;
}

/**
 * After popping a group, we remove any clusters not connected to the ceiling.
 * These "floating" bubbles drop and award extra points.
 */
function removeFloatingBubbles() {
    const topConnected = new Set();
    const queue = [];

    // Any bubble touching the ceiling is considered anchored
    for (const b of bubbles) {
        if (b.y <= BUBBLE_RADIUS * 1.5) {
            topConnected.add(b);
            queue.push(b);
        }
    }

    // BFS to find all bubbles connected to the top anchors
    while (queue.length > 0) {
        const b = queue.shift();
        for (const other of bubbles) {
            if (topConnected.has(other)) continue;
            if (distanceSq(b, other) <= NEIGHBOR_DIST_SQ) {
                topConnected.add(other);
                queue.push(other);
            }
        }
    }

    const before = bubbles.length;
    const survivors = bubbles.filter((b) => topConnected.has(b));
    const fallenCount = before - survivors.length;

    if (fallenCount > 0) {
        score += fallenCount * 5;
        playFallSound(fallenCount);
        maybeUpdateHighScore();
        updateHUD();
    }

    bubbles = survivors;
}

/**
 * Apply color matching rules after a bubble is placed:
 * - If a same-color cluster of size >= 3 is formed, remove it.
 * - Then remove floating clusters not connected to the ceiling.
 */
function handleMatches(sourceBubble) {
    const matchGroup = floodFillColor(sourceBubble);
    if (matchGroup.length >= 3) {
        const toRemove = new Set(matchGroup);
        const removedCount = matchGroup.length;
        bubbles = bubbles.filter((b) => !toRemove.has(b));

        score += removedCount * 10;
        playPopSound(removedCount);
        maybeUpdateHighScore();
        updateHUD();

        removeFloatingBubbles();
    }
}

function checkLose() {
    for (const b of bubbles) {
        if (b.y + b.radius >= SHOOTER_Y - 5) {
            return true;
        }
    }
    return false;
}

/**
 * Attach the moving bubble into the grid:
 * - If it collided with another bubble, try snapping into one of the 6 neighbor slots.
 * - If it hit the ceiling, clamp to top.
 * - Then apply matching and win/lose checks.
 */
function attachCurrentBubble(collidedWith = null) {
    if (!currentBubble) return;

    let placedX = currentBubble.x;
    let placedY = currentBubble.y;

    if (collidedWith) {
        const snapPos = findSnapPosition(collidedWith, currentBubble);
        if (snapPos) {
            placedX = snapPos.x;
            placedY = snapPos.y;
        } else {
            const angle = Math.atan2(currentBubble.dy, currentBubble.dx);
            const dist = currentBubble.radius * 2;
            placedX = collidedWith.x - Math.cos(angle) * dist;
            placedY = collidedWith.y - Math.sin(angle) * dist;
        }
    } else {
        if (placedY < BUBBLE_RADIUS) placedY = BUBBLE_RADIUS;
    }

    currentBubble.moving = false;
    const placedBubble = {
        x: placedX,
        y: placedY,
        radius: currentBubble.radius,
        color: currentBubble.color
    };
    bubbles.push(placedBubble);

    handleMatches(placedBubble);

    // All bubbles cleared → level cleared, auto-next-level
    if (bubbles.length === 0) {
        playWinSound();
        maybeUpdateHighScore();
        setTimeout(() => {
            if (gameState === GameState.PLAYING) {
                nextLevel();
            }
        }, 900);
        return;
    }

    // Check if bubbles reached the shooter line
    if (checkLose()) {
        gameState = GameState.GAMEOVER;
        playLoseSound();
        return;
    }

    spawnCurrentBubble();
}

// ====================== TRAJECTORY PREVIEW (BOUNCE PATH) ======================

/**
 * Simulate the path the bubble will take if fired:
 * - Step forward in small increments.
 * - Reflect direction when touching left/right walls.
 * - Stop when hitting ceiling or a bubble.
 *
 * This is used only for rendering the dotted aiming line.
 */
function computeTrajectory() {
    previewPath = [];
    if (!currentBubble || currentBubble.moving) return;
    if (gameState !== GameState.PLAYING) return;

    let pos = { x: currentBubble.x, y: currentBubble.y };
    let dir = { x: aimDir.x, y: aimDir.y };

    previewPath.push({ x: pos.x, y: pos.y });

    const collideDistSq = (BUBBLE_RADIUS * 2) ** 2;

    for (let i = 0; i < MAX_TRAJECTORY_STEPS; i++) {
        pos.x += dir.x * TRAJECTORY_STEP;
        pos.y += dir.y * TRAJECTORY_STEP;

        // Bounce off side walls
        if (pos.x <= BUBBLE_RADIUS) {
            pos.x = BUBBLE_RADIUS;
            dir.x *= -1;
        } else if (pos.x >= WIDTH - BUBBLE_RADIUS) {
            pos.x = WIDTH - BUBBLE_RADIUS;
            dir.x *= -1;
        }

        // Stop at ceiling
        if (pos.y <= BUBBLE_RADIUS) {
            pos.y = BUBBLE_RADIUS;
            previewPath.push({ x: pos.x, y: pos.y });
            break;
        }

        // Stop when predicted to hit a bubble
        let hit = false;
        for (const b of bubbles) {
            const dsq = (pos.x - b.x) ** 2 + (pos.y - b.y) ** 2;
            if (dsq <= collideDistSq * 0.9) {
                hit = true;
                break;
            }
        }

        previewPath.push({ x: pos.x, y: pos.y });
        if (hit) break;
    }
}

// ====================== UPDATE & RENDER LOOP ======================

function update() {
    if (gameState !== GameState.PLAYING) return;

    if (currentBubble && currentBubble.moving) {
        currentBubble.x += currentBubble.dx;
        currentBubble.y += currentBubble.dy;

        // Bounce off walls
        if (currentBubble.x - currentBubble.radius <= 0) {
            currentBubble.x = currentBubble.radius;
            currentBubble.dx *= -1;
        } else if (currentBubble.x + currentBubble.radius >= WIDTH) {
            currentBubble.x = WIDTH - currentBubble.radius;
            currentBubble.dx *= -1;
        }

        // Hit top
        if (currentBubble.y - currentBubble.radius <= 0) {
            currentBubble.y = currentBubble.radius;
            attachCurrentBubble();
            return;
        }

        // Hit another bubble
        const collideDistSq = (currentBubble.radius * 2) ** 2;
        for (const b of bubbles) {
            if (distanceSq(currentBubble, b) <= collideDistSq * 0.9) {
                attachCurrentBubble(b);
                return;
            }
        }
    }
}

function drawBubble(b) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
    ctx.closePath();
    const gradient = ctx.createRadialGradient(
        b.x - b.radius * 0.4,
        b.y - b.radius * 0.4,
        b.radius * 0.2,
        b.x,
        b.y,
        b.radius
    );
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(0.3, b.color);
    gradient.addColorStop(1, "#000000");
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1.3;
    ctx.stroke();
}

/** Draw cannon base + barrel rotated toward aimDir. */
function drawShooter() {
    const baseX = WIDTH / 2;
    const baseY = SHOOTER_Y + 16;

    ctx.save();
    ctx.translate(baseX, baseY);

    const grd = ctx.createLinearGradient(-30, 0, 30, 0);
    grd.addColorStop(0, "#181b22");
    grd.addColorStop(1, "#080910");
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(0, 0, 28, Math.PI, 0, false);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 1;
    ctx.stroke();

    const angle = Math.atan2(aimDir.y, aimDir.x);
    ctx.save();
    ctx.translate(0, -16);
    ctx.rotate(angle);
    ctx.fillStyle = "#606775";
    if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(0, -6, 40, 12, 6);
        ctx.fill();
    } else {
        ctx.fillRect(0, -6, 40, 12);
    }
    ctx.restore();

    ctx.restore();
}

/** Render dotted line along the predicted trajectory. */
function drawTrajectory() {
    if (previewPath.length < 2) return;

    ctx.save();
    const grad = ctx.createLinearGradient(
        previewPath[0].x,
        previewPath[0].y,
        previewPath[previewPath.length - 1].x,
        previewPath[previewPath.length - 1].y
    );
    grad.addColorStop(0, "rgba(255,255,255,0.4)");
    grad.addColorStop(1, "rgba(255,255,255,0.05)");
    ctx.strokeStyle = grad;
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(previewPath[0].x, previewPath[0].y);
    for (let i = 1; i < previewPath.length; i++) {
        ctx.lineTo(previewPath[i].x, previewPath[i].y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
}

/** Draw the preview for the next bubble color at bottom-right. */
function drawNextBubblePreview() {
    if (!nextBubbleColor) return;
    const r = BUBBLE_RADIUS * 0.8;
    const x = WIDTH - 50;
    const y = HEIGHT - 40;
    ctx.font = "12px system-ui";
    ctx.fillStyle = "#ffffffcc";
    ctx.textAlign = "right";
    ctx.fillText("Next", WIDTH - 12, HEIGHT - 60);
    const bubble = { x, y, radius: r, color: nextBubbleColor };
    drawBubble(bubble);
}

/** Info overlay for the "Game Over" state (separate from HTML overlays). */
function drawGameOverOverlay() {
    if (gameState !== GameState.GAMEOVER) return;
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(0, HEIGHT / 2 - 60, WIDTH, 120);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.font = "22px system-ui";
    ctx.fillText("Game Over", WIDTH / 2, HEIGHT / 2 - 6);
    ctx.font = "14px system-ui";
    ctx.fillText(`Score: ${score}`, WIDTH / 2, HEIGHT / 2 + 16);
    ctx.fillText("Press Restart or go to Menu", WIDTH / 2, HEIGHT / 2 + 38);
}

function draw() {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    // Always recompute trajectory from latest aimDir
    computeTrajectory();

    drawShooter();

    for (const b of bubbles) {
        drawBubble(b);
    }

    if (currentBubble) {
        drawBubble(currentBubble);
    }

    drawTrajectory();
    drawNextBubblePreview();
    drawGameOverOverlay();
}

function gameLoop() {
    update();
    draw();
    requestAnimationFrame(gameLoop);
}

// ====================== MENU / PAUSE CONTROLS ======================

function startNewGame() {
    gameState = GameState.PLAYING;
    resetLevel(true);
    showMenuOverlay(false);
    showPauseOverlay(false);
}

function continueGame() {
    // For now, just resume the current in-memory state.
    gameState = GameState.PLAYING;
    showMenuOverlay(false);
    showPauseOverlay(false);
}

function pauseGame() {
    if (gameState !== GameState.PLAYING) return;
    gameState = GameState.PAUSED;
    showPauseOverlay(true);
}

function resumeGame() {
    if (gameState !== GameState.PAUSED) return;
    gameState = GameState.PLAYING;
    showPauseOverlay(false);
}

function goToMainMenu() {
    gameState = GameState.MENU;
    showPauseOverlay(false);
    showMenuOverlay(true);
}

// Button wiring

restartBtn.addEventListener("click", () => {
    if (gameState === GameState.MENU) {
        startNewGame();
    } else {
        gameState = GameState.PLAYING;
        resetLevel(false); // restart same level, keep score+level
    }
});

pauseBtn.addEventListener("click", () => {
    if (gameState === GameState.PLAYING) pauseGame();
    else if (gameState === GameState.PAUSED) resumeGame();
});

menuStartBtn.addEventListener("click", startNewGame);
menuContinueBtn.addEventListener("click", continueGame);

pauseResumeBtn.addEventListener("click", resumeGame);
pauseRestartBtn.addEventListener("click", () => {
    showPauseOverlay(false);
    gameState = GameState.PLAYING;
    resetLevel(false);
});
pauseMenuBtn.addEventListener("click", goToMainMenu);

// ====================== BOOTSTRAP ======================

loadHighScore();
updateHUD();
resetLevel(true);
gameState = GameState.MENU;
showMenuOverlay(true);
showPauseOverlay(false);

// Start render loop
gameLoop();

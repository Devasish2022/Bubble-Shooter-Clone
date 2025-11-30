# Bubble Shooter – HTML5 Canvas Game

A classic Bubble Shooter game built with **HTML, CSS, and vanilla JavaScript**, designed to run smoothly on both **desktop and mobile browsers**.

You aim, bounce shots off the side walls, match colors, and clear all bubbles while the difficulty ramps up with each level.

---

## 🎮 Features

- **Physics-style aiming**
  - Mouse / touch aiming
  - Live **trajectory preview** with wall bounces
- **Smart bubble placement**
  - Hex-style **snapping** into gaps between bubbles
  - Clusters connect cleanly even at angles
- **Match & clear system**
  - Pop groups of **3+ same-color bubbles**
  - Floating clusters **fall** if they’re not connected to the ceiling
- **Progression & scoring**
  - Increasing difficulty via **more rows + more colors per level**
  - Score system:
    - `+10` points × bubbles in a popped group  
    - `+5` points × bubbles that fall
  - **High score** saved via `localStorage`
- **Game flow**
  - Main menu (Start / Continue)
  - Pause menu (Resume / Restart level / Back to menu)
  - Keyboard pause toggle (`P` / `Esc`)
- **Audio**
  - Lightweight **Web Audio API** beeps for shooting, popping, falling, win/lose
  - No external sound assets
- **Responsive design**
  - Scales to mobile width
  - Touch-friendly controls
- Lightweight & dependency-free (no frameworks)

---

## 🧩 Project Structure

```text
bubble-shooter/
  index.html   # Layout, HUD, overlays, footer
  styles.css   # Visual styling, layout, responsive tweaks
  game.js      # Game logic, rendering, input, audio
  README.md    # Project documentation

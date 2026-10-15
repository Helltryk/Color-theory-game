# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

Game Link:
https://color-theory-game.kimi.page



Chat History:
User: Create a web deployable game project.

In this project, recreate ultrakill style movement (with camera) and gunplay in a wave based horde shooter with the main theme being the color wheel. The premise being that the world is the most boring gray and the protagonist, a genderless android, is created by a lonely person who dies at start of the game. 

The protagonist has three weapons, a shotgun, an assault rifle shotgun, and a sniper rifle. Normal enemies can only be killed by the colorless assault rifle the protagonist has. the player only has 6 colors, two levels of saturation and two levels of hue in his shotgun and Sniper rifle. Every 6 waves is a boss battle which becomes a standard elite enemy from the next wave onwards. The player accesses the color wheel by holding down tab to make an actual colorwheel show up.

Every elite enemy has one of two types of energy shields, a spherical shield and a triangular prism shield, and each can have a random color from the basic 6 the protagonist has. Spherical ones, are more common and can only be broken with a shotgun using a matching color, hue and saturation. Prism ones are rare can only be broken by the sniper rifle and using the opposite saturation, hue and color.

The fodder enemies are the model uploaded and the elite enemies are augmented humans in power armor that resembles futuristic knights. The atmosphere is dull and bleak with any prominent colors being astronomically rare, aka the energy shields and the bullet trails of the shotgun and sniper rifle. the assault rifle has infinte ammo but the Shotgun has a cooldown of 3 secs and the sniper has limited supply.

Add a proper start screen and settings menu with rebindable controls for everything. Also add sound design like in Armored Core and Halo. Elite enemies with round shields drop sniper ammo for player to pick up and give the shields their own hit box. make the hint text when aiming at a shield to be bright green with black outline.

Give the player a parry mechanic exactly like Ultrakill with a wide cone of effect, bind it to the E key. and disable camera when using the color wheel and make time slowdown when using the color wheel.

Use any free to use models that suit the enemies from the internet and put them in a separate folder for each. Use ECS and many other optimization tricks possible for this project. Make sure the mouse works.
Kimi: `models/fodder_droid/` holds your converted droid; `models/elite_knight/` holds the KayKit knight (CC0 license, attribution included in each folder).
User: update the fodder enemies with robot.glb and the elite enemies with droid.glb, increase the jump by four time the vertical height and add proper wallrunning and walljumping.
Kimi: Done — new version saved and ready to preview.

**What changed:**

1. **Models swapped** — fodder enemies are now your `Robot.glb`, elite enemies are your `droid.glb` (normalized to 1.9m / 2.0m heights, gray-graded with the pale visor glow kept). Since the droid model has no baked animation clips, elites now get procedural motion instead: chase bob, a rear-back telegraph before strikes (still parryable), lunge on hit, and a stagger wobble when their shield shatters. The model folders in the deliverables were updated too: `models/fodder_robot/` and `models/elite_droid/`, each with its attribution file.

2. **Jump × 4 height** — jump velocity went from 9.5 to 19 m/s. Verified in-engine: apex is now ~7.1m (was ~1.74m), so you can clear monoliths and reach walls high up.

3. **Proper wallrunning** — jump onto a wall while moving fast (≥5.5 m/s) with any movement input and you latch on:
   - Gravity drops to ~17% while riding (you sink only ~2m over a full run instead of falling)
   - A stick force keeps you pressed to the wall so contact never drops mid-run
   - Camera leans ~13° into the wall with an FOV kick and a servo sound on entry
   - Runs up to 2.2s, ends on landing, losing the wall, or dropping below speed — with a short re-grab cooldown so you don't re-stick instantly

4. **Improved walljumping** — jumping off a wall (wallrunning or just touching) now cancels only your into-wall velocity and *keeps your tangential speed*, then adds a push-off plus nearly full jump power (full power from a wallrun). Verified: launched 10m off the wall with a 9m apex.

All verified headless in the real build: wave spawns, elite shields, and combat still work with zero console errors. High scores, settings, and bindings remain browser-local (localStorage) as before.
User: Now animate the movements of the enemies and make the elite enemies capable of dodging.
Kimi: Done — new version saved and ready to preview.

**Procedural skeletal animation** — since neither uploaded model ships with baked animation clips, I built a bone-level animation system that drives their skeletons directly (offsets layered on the authored rest pose, so nothing distorts):

- **Fodder robots**: full walk cycle — thighs swing, knees bend through the stride, feet counter-rotate, arms counter-swing, spine twists and sways. During their melee telegraph both arms rise overhead before the strike swings down; idle robots get a subtle breathing sway.
- **Elite droids**: run gait while chasing, menacing arm-sway at melee range, an overhead wind-up for the parryable attack, a wobble-and-lean stagger when their shield breaks, and a hard lean with trailing arms during dodges.

One fix along the way: the loader strips dots from bone names (`thigh.L` → `thighL`), so the rig matcher now normalizes names — verified all bones bind on both models.

**Elite dodging** — three triggers, all tuned so dodges are threatening but readable:
- **Reaction dash**: firing the shotgun or sniper at an elite gives it a chance (50%, boss 30%) to burst sideways at 15 m/s the instant you shoot — your current shot still lands, but your follow-up aim is broken
- **Crosshair pressure**: holding your crosshair on an elite for ~0.45s can provoke a proactive sidestep (30%, boss 14%) — snap-shoot, don't stare
- **Parry counter-play**: reflected projectiles have travel time, so targeted elites get a 40% chance to actually sidestep the orb mid-flight

Dodges have a ~2.2–3.5s cooldown, never interrupt staggers or committed attacks, play a servo-whoosh sound cue, and kick up a small dust burst so you can read them. Combat regression verified: fodder still die only to the rifle, sphere shields still break to matched shotgun fire with stagger, and all of it runs with zero errors.

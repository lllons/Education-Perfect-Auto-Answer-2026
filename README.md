<div align="center">
<img src="https://raw.githubusercontent.com/lllons/Education-Perfect-Auto-Answer-2026/main/R.png" width="150">
</div>

# EP Answer Assistant

A fast userscript for automatically filling answers on Education Perfect using live extraction, fuzzy matching, and cursor-aware typing. (FOR EDUCATION PURPOSES ONLY ;) )

---
<div align="center">

![Version](https://img.shields.io/badge/version-3.5.0-blue)
![Platform](https://img.shields.io/badge/platform-Tampermonkey-green)
![Language](https://img.shields.io/badge/language-JavaScript-yellow)
![Status](https://img.shields.io/badge/status-active-success)
![License](https://img.shields.io/badge/license-MIT-purple)

</div>

> ###### Note: The implement folder contains the html layout of different areas around education perfect, used for AI context and personal reference. 

### Branches

**`main`** — This is the **Hunter** version. It is still in develoment. (Not infused with AI right now)

**`Published`** — This is the **GreasyFork** version. It is the script that is hosted on GreasyFork. **RECOMENDED FOR ALL** (Great speed, no AI as of the moment)

**`full`** — This is the **AI-powered beta branch**. It uses advanced AI for significantly better question understanding and answer accuracy. The **full** branch is actively getting the latest improvements and experimental features. 

#### You can switch between the `main` and `full` branches depending on whether you prefer stability or AI 
---

## Features

- Auto-types answers directly at the current cursor position
- Fuzzy matching
- Automatically extracts pairs from EP pages
- Real-time question detection
- Supports standard inputs and contenteditable fields
- Angular-safe event dispatching
- Draggable floating control panel
- Pause / resume controls
- Toast notifications
- Optimized for speed and low overhead

---

# Preview

```txt
EP Assistant
128 pairs loaded

[ Load ] [ Pause ]

Typing: "bonjour" → "hello"
````

---

# Installation

## 1. Install Tampermonkey

### Chrome

[https://www.tampermonkey.net/](https://www.tampermonkey.net/)

### Firefox

[https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/)

---

## 2. Create a New Script

1. Open Tampermonkey
2. Click:

```txt
Create a new script
```

3. Replace everything with the script contents
4. Save with:

```txt
CTRL + S
```

---

## 3. Open Education Perfect

Navigate to:

```txt
https://app.educationperfect.com/
```

Open a list and click:

```txt
Load
```

The assistant will begin automatically filling answers.

---

# Configuration

All configurable settings are stored in:

```js
const CFG = {
  fuzzyThreshold : 0.60,
  typeDelay      : 20,
  toastDuration  : 3000,
  pollInterval   : 2000,
  cooldown       : 2000,
  typeCooldown   : 1500,
};
```

# Contributing

Pull requests, optimizations, and fixes are welcome.


---

# License

MIT License

---

# Disclaimer

This project is provided for educational and research purposes only.

Use responsibly and comply with your institution's policies.

```
```

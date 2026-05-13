
# EP Answer Assistant

A fast, lightweight Tampermonkey userscript for automatically filling answers on Education Perfect using live extraction, fuzzy matching, and cursor-aware typing.

---

<div align="center">

![Version](https://img.shields.io/badge/version-3.5.0-blue)
![Platform](https://img.shields.io/badge/platform-Tampermonkey-green)
![Language](https://img.shields.io/badge/language-JavaScript-yellow)
![Status](https://img.shields.io/badge/status-active-success)
![License](https://img.shields.io/badge/license-MIT-purple)

</div>

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

---

# Speed Tuning

## Ultra Fast Preset

```js
const CFG = {
  fuzzyThreshold : 0.3,
  typeDelay      : 0,
  toastDuration  : 1500,
  pollInterval   : 500,
  cooldown       : 300,
  typeCooldown   : 0,
};
```

---

# How It Works

The script:

1. Extracts pairs from the current page
2. Normalizes text for reliable matching
3. Detects active questions in real-time
4. Finds the closest answer using fuzzy search
5. Types directly into the active cursor location
6. Dispatches Angular-safe input events

---

# Stability Features

This script includes protections against:

* AngularJS transition crashes
* Duplicate answer spam
* Event flooding
* UI-router instability
* Route-change typing issues

---

# Architecture

```txt
┌────────────────────┐
│ Vocabulary Loader  │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ Answer Map Builder │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ Question Detector  │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ Fuzzy Matcher      │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ Cursor Typing      │
└────────────────────┘
```

---

# Performance Notes

The script is optimized to minimize:

* DOM scanning
* Angular digest interference
* Mutation observer overhead
* Synthetic keyboard event spam

For best performance:

```js
typeDelay: 0
pollInterval: 500
typeCooldown: 0
```

---

# Supported Features

| Feature                 | Supported |
| ----------------------- | --------- |
| Auto answer fill        | Yes       |
| Cursor-aware typing     | Yes       |
| Contenteditable support | Yes       |
| Fuzzy matching          | Yes       |
| Angular-safe input      | Yes       |
| Draggable UI            | Yes       |
| Pause / resume          | Yes       |
| Live  extraction   | Yes       |

---

# Known Limitations

* Requires the list to be visible before loading
* Extremely aggressive speed settings may cause duplicate fills
* Some custom EP activities may use unsupported input methods

---

# Development

## Local Editing

Recommended setup:

```txt
VS Code
Tampermonkey
Chrome DevTools
```

---

## Debugging

Open DevTools:

```txt
F12 → Console
```

The script outputs detailed logs:

```txt
[EP] Loaded 128 pairs
[EP] "bonjour" → "hello"
```

---

# Contributing

Pull requests, optimizations, and fixes are welcome.

Suggested areas for improvement:

* Better question parsing
* Smarter fuzzy matching
* Multi-language optimizations
* Reduced DOM overhead
* Faster lookup structures

---

# License

MIT License

---

# Disclaimer

This project is provided for educational and research purposes only.

Use responsibly and comply with your institution's policies.

```
```

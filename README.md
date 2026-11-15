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

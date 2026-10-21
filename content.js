(function () {
  'use strict';

  const TAG = '[block-tracking]';
  // Grab the real console.log now before any page script can replace it
  const nativeLog = console.log.bind(console);

  // ================= CONFIG: flip any of these to false =================
  // Devtools detection
  const SANITIZE_CONSOLE = true;     // stop console.log(obj-with-getter) tricks
  const BLOCK_CONSOLE_CLEAR = true;  // stop pages from wiping your console
  const SPOOF_WINDOW_SIZE = true;    // hide docked-devtools size differences
  // Tab / window switching, Lens, alt-tab
  const HIDE_MOUSE_LEAVE = true;     // cursor leaving the page (to browser UI, Lens overlay, other window)
  const HIDE_KEYS = true;            // bare Alt/Meta/PrintScreen + F12/devtools shortcuts
  const HIDE_CLIPBOARD_EVENTS = true;// copy / cut / contextmenu (right-click "Search with Lens")
  const HIDE_PASTE_EVENT = false;    // also hide paste (can break rich-text editors)
  const HIDE_MULTI_MONITOR = true;   // screen.isExtended / getScreenDetails()
  const KEEP_RAF_ALIVE = true;       // requestAnimationFrame keeps ticking in a hidden tab
  const KEEP_AUDIO_ALIVE = false;    // silent audio keeps timers unthrottled (shows speaker icon on the tab)
  const BLOCK_RESIZE_EVENTS = false; // hide resize (Lens/side panels shrink the viewport); can break responsive JS
  // =======================================================================
  const counts = {};
  const lastLogged = {};

  const log = (kind, name, extra = '') => {
    const key = `${kind}:${name}`;
    counts[key] = (counts[key] || 0) + 1;
    nativeLog(
      `%c${TAG} blocked ${kind} "${name}" (#${counts[key]}) ${extra}`,
      'color:lime; font-weight:bold'
    );
  };


  const logThrottled = (kind, name, ms = 1000) => {
    const key = `${kind}:${name}`;
    counts[key] = (counts[key] || 0) + 1;
    const now = Date.now();
    if (now - (lastLogged[key] || 0) >= ms) {
      lastLogged[key] = now;
      nativeLog(
        `%c${TAG} spoofed ${kind} "${name}" (read ${counts[key]}x so far)`,
        'color:cyan'
      );
    }
  };

  // Make our fakes look native to Function.prototype.toString()
  const nativeToString = Function.prototype.toString;
  const fakes = new WeakMap(); // fake function -> native-looking source string
  const toStringProxy = new Proxy(nativeToString, {
    apply(target, thisArg, args) {
      return fakes.has(thisArg) ? fakes.get(thisArg) : Reflect.apply(target, thisArg, args);
    },
  });
  fakes.set(toStringProxy, 'function toString() { [native code] }');
  Object.defineProperty(Function.prototype, 'toString', {
    ...Object.getOwnPropertyDescriptor(Function.prototype, 'toString'),
    value: toStringProxy,
  });


  const findOwner = (obj, prop) => {
    for (let o = obj; o; o = Object.getPrototypeOf(o)) {
      if (Object.prototype.hasOwnProperty.call(o, prop)) return o;
    }
    return null;
  };

  // Real state, captured before we spoof anything 
  const hiddenGetter = (Object.getOwnPropertyDescriptor(Document.prototype, 'hidden') || {}).get;
  const nativeHasFocus = Document.prototype.hasFocus;
  const realHidden = () => {
    try { return hiddenGetter ? Reflect.apply(hiddenGetter, document, []) : false; } catch (_) { return false; }
  };
  const realHasFocus = () => {
    try { return Reflect.apply(nativeHasFocus, document, []); } catch (_) { return true; }
  };
  const visHooks = []; 


  // 1. Spoof state checks 
  const spoofGetter = (proto, prop, value) => {
    const orig = Object.getOwnPropertyDescriptor(proto, prop);
    if (!orig) return;
    // Object-literal getter => correct name ("get hidden"), no prototype, length 0
    const getter = Object.getOwnPropertyDescriptor(
      { get [prop]() { logThrottled('state check', prop); return value; } },
      prop
    ).get;
    fakes.set(getter, `function get ${prop}() { [native code] }`);
    Object.defineProperty(proto, prop, { ...orig, get: getter });
  };

  spoofGetter(Document.prototype, 'hidden', false);
  spoofGetter(Document.prototype, 'visibilityState', 'visible');
  spoofGetter(Document.prototype, 'webkitHidden', false);
  spoofGetter(Document.prototype, 'webkitVisibilityState', 'visible');

  const hasFocus = {
    hasFocus() { logThrottled('state check', 'hasFocus()'); return true; },
  }.hasFocus;
  fakes.set(hasFocus, 'function hasFocus() { [native code] }');
  const origHasFocus = Object.getOwnPropertyDescriptor(Document.prototype, 'hasFocus');
  if (origHasFocus) {
    Object.defineProperty(Document.prototype, 'hasFocus', { ...origHasFocus, value: hasFocus });
  }


  // Kill the events before any page listener sees them
  const blocked = ['visibilitychange', 'webkitvisibilitychange', 'blur', 'focus', 'focusout', 'pagehide', 'freeze'];
  blocked.forEach(type => {
    window.addEventListener(type, e => {
      if (type === 'visibilitychange') visHooks.forEach(f => { try { f(); } catch (_) {} });
      // Element-level focus changes: let them through while the window really has focus
      // (typing in inputs), but hide the ones caused by the window itself losing focus.
      if ((type === 'blur' || type === 'focus' || type === 'focusout') && e.target !== window && e.target !== document) {
        if (realHasFocus()) return;
      }
      e.stopImmediatePropagation();
      log('event', type, `(target: ${e.target === window ? 'window' : e.target === document ? 'document' : e.target.nodeName})`);
    }, true);
  });


  ['onblur', 'onfocus', 'onvisibilitychange', 'onpagehide'].forEach(p => {
    [window, document].forEach(t => {
      const owner = findOwner(t, p);
      if (!owner) return;
      const orig = Object.getOwnPropertyDescriptor(owner, p);
      if (!orig || !orig.configurable) return;
      const holder = {
        get [p]() { return null; },
        set [p](fn) { log('handler assignment', p, `on ${t === window ? 'window' : 'document'}`); },
      };
      const d = Object.getOwnPropertyDescriptor(holder, p);
      fakes.set(d.get, `function get ${p}() { [native code] }`);
      fakes.set(d.set, `function set ${p}() { [native code] }`);
      Object.defineProperty(owner, p, { ...orig, get: d.get, set: d.set });
    });
  });


  const con = console;
  const redefine = (obj, prop, patch) =>
    Object.defineProperty(obj, prop, { ...Object.getOwnPropertyDescriptor(obj, prop), ...patch });

  if (SANITIZE_CONSOLE) {
    const safe = a => {
      const t = typeof a;
      if (a === null || (t !== 'object' && t !== 'function')) return a;
      return t === 'function' ? '[function]' : '[object]';
    };
    ['log', 'debug', 'info', 'warn', 'error', 'table', 'dir', 'dirxml',
     'trace', 'group', 'groupCollapsed', 'assert'].forEach(m => {
      const origFn = con[m];
      if (typeof origFn !== 'function') return;
      const wrapper = { [m](...args) { return Reflect.apply(origFn, con, args.map(safe)); } }[m];
      fakes.set(wrapper, `function ${m}() { [native code] }`);
      redefine(con, m, { value: wrapper });
    });
  }

  if (BLOCK_CONSOLE_CLEAR && typeof con.clear === 'function') {
    const clear = { clear() {} }.clear;
    fakes.set(clear, 'function clear() { [native code] }');
    redefine(con, 'clear', { value: clear });
  }


  if (SPOOF_WINDOW_SIZE) {
    const spoofSize = (prop, innerProp, maxGap, fallbackGap) => {
      const owner = findOwner(window, prop);
      if (!owner) return;
      const orig = Object.getOwnPropertyDescriptor(owner, prop);
      if (!orig || !orig.get || !orig.configurable) return;
      const getter = Object.getOwnPropertyDescriptor({
        get [prop]() {
          const outer = Reflect.apply(orig.get, this, []);
          const inner = this[innerProp];
          return outer - inner > maxGap ? inner + fallbackGap : outer;
        },
      }, prop).get;
      fakes.set(getter, `function get ${prop}() { [native code] }`);
      Object.defineProperty(owner, prop, { ...orig, get: getter });
    };
    spoofSize('outerWidth', 'innerWidth', 100, 8);
    spoofSize('outerHeight', 'innerHeight', 150, 90);
  }

  const hideEvents = (types, test, label) => {
    types.forEach(type => window.addEventListener(type, e => {
      if (test(e)) { e.stopImmediatePropagation(); logThrottled(label, type); }
    }, true));
  };

  // Cursor leaving the page
  if (HIDE_MOUSE_LEAVE) {
    hideEvents(['mouseout', 'pointerout', 'mouseleave', 'pointerleave'], e => e.relatedTarget === null, 'mouse-leave');
  }

  // Keys that reveal alt-tabbing / screenshots / devtools shortcuts
  if (HIDE_KEYS) {
    const bare = new Set(['Alt', 'Meta', 'OS', 'PrintScreen']);
    const devtoolsKey = e =>
      e.code === 'F12' ||
      ((e.ctrlKey || e.metaKey) && (e.shiftKey || e.altKey) && (e.code === 'KeyI' || e.code === 'KeyJ' || e.code === 'KeyC')) ||
      ((e.ctrlKey || e.metaKey) && e.code === 'KeyU');
    hideEvents(['keydown', 'keyup', 'keypress'], e => bare.has(e.key) || devtoolsKey(e), 'key');
  }

  // For Google Lens
  if (HIDE_CLIPBOARD_EVENTS) {
    hideEvents(['copy', 'cut', 'contextmenu'].concat(HIDE_PASTE_EVENT ? ['paste'] : []), () => true, 'clipboard');
  }


  if (BLOCK_RESIZE_EVENTS) {
    hideEvents(['resize'], e => e.target === window, 'resize');
  }

  // 5e. Multi-monitor detection.
  if (HIDE_MULTI_MONITOR) {
    try { if (window.Screen) spoofGetter(Screen.prototype, 'isExtended', false); } catch (_) {}
    if (typeof window.getScreenDetails === 'function') {
      const getScreenDetails = {
        getScreenDetails() { return Promise.reject(new DOMException('Permission denied.', 'NotAllowedError')); },
      }.getScreenDetails;
      fakes.set(getScreenDetails, 'function getScreenDetails() { [native code] }');
      redefine(window, 'getScreenDetails', { value: getScreenDetails });
    }
  }

  if (KEEP_RAF_ALIVE) {
    try {
      const nativeRAF = window.requestAnimationFrame;
      const nativeCAF = window.cancelAnimationFrame;
      const NativeWorker = window.Worker;
      const NativeBlob = window.Blob;
      const createURL = URL.createObjectURL.bind(URL);
      const perfNow = performance.now.bind(performance);
      const report = typeof window.reportError === 'function' ? window.reportError.bind(window) : (e => nativeLog(e));
      if (typeof nativeRAF !== 'function' || typeof NativeWorker !== 'function') throw new Error('unsupported');

      let worker = null;
      let workerBroken = false;
      let nextId = 0x40000000;          // ours never collide with native ids
      const ticks = new Map();          // id -> callback waiting on the worker clock
      const pending = new Map();        // native id -> callback waiting on a real frame

      const getWorker = () => {
        if (worker || workerBroken) return worker;
        try {
          const url = createURL(new NativeBlob(
            ['onmessage=e=>setTimeout(()=>postMessage(e.data),16)'], { type: 'text/javascript' }));
          worker = new NativeWorker(url);
          worker.onmessage = e => {
            const cb = ticks.get(e.data);
            if (!cb) return;
            ticks.delete(e.data);
            try { cb(perfNow()); } catch (err) { report(err); }
          };
          worker.onerror = () => {        // e.g. blocked by the page's CSP
            workerBroken = true;
            worker = null;
            ticks.forEach((cb, id) => { ticks.delete(id); setTimeout(() => cb(perfNow()), 16); });
          };
        } catch (_) { workerBroken = true; worker = null; }
        return worker;
      };

      const tickLater = (id, cb) => {
        const w = getWorker();
        if (!w) return false;
        ticks.set(id, cb);
        w.postMessage(id);
        return true;
      };

      const shim = {
        requestAnimationFrame(cb) {
          const isFn = typeof cb === 'function';
          if (isFn && realHidden()) {
            const tid = ++nextId;
            if (tickLater(tid, cb)) return tid;
          }
          const id = Reflect.apply(nativeRAF, window, [isFn ? (ts => { pending.delete(id); return cb(ts); }) : cb]);
          if (isFn) pending.set(id, cb);
          return id;
        },
        cancelAnimationFrame(id) {
          if (ticks.delete(id)) return;
          pending.delete(id);
          return Reflect.apply(nativeCAF, window, [id]);
        },
      };

      // When the tab goes hidden, move frames that were already queued over to the worker.
      visHooks.push(() => {
        if (!realHidden()) return;
        Array.from(pending).forEach(([id, cb]) => {
          if (tickLater(id, cb)) {
            pending.delete(id);
            Reflect.apply(nativeCAF, window, [id]);
          }
        });
      });

      ['requestAnimationFrame', 'cancelAnimationFrame'].forEach(name => {
        fakes.set(shim[name], `function ${name}() { [native code] }`);
        redefine(window, name, { value: shim[name] });
      });
    } catch (_) { /* leave rAF alone if anything is unsupported */ }
  }


  if (KEEP_AUDIO_ALIVE) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      let actx = null;
      const wake = () => {
        try {
          if (!actx) {
            actx = new AC();
            const osc = actx.createOscillator();
            const gain = actx.createGain();
            gain.gain.value = 0.002;
            osc.connect(gain);
            gain.connect(actx.destination);
            osc.start();
          }
          if (actx.state === 'suspended') actx.resume();
        } catch (_) {}
      };
      ['pointerdown', 'keydown', 'touchend'].forEach(t =>
        window.addEventListener(t, wake, { capture: true, passive: true }));
    }
  }

  nativeLog(`%c${TAG} armed at document-start`, 'color:lime');
})();

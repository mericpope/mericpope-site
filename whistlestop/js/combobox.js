// Accessible type-ahead for a text input (ARIA 1.2 "combobox" + "listbox").
//   - type to search; Arrow keys move, Enter/click/tap picks, Escape closes
//   - the picked suggestion carries its own coordinates (no second lookup)
//   - if the user never picks, resolve() quietly uses the best match so
//     pressing Search still works
let uid = 0;

export function attachCombobox(input, { getSuggestions, delay = 250, minChars = 2 }) {
  const id = `combo-${++uid}`;
  const wrap = document.createElement("div");
  wrap.className = "combo";
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  const list = document.createElement("ul");
  list.className = "suggestions";
  list.id = id;
  list.setAttribute("role", "listbox");
  list.hidden = true;
  wrap.appendChild(list);

  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", id);
  input.setAttribute("autocomplete", "off");
  input.setAttribute("spellcheck", "false");

  let items = [];
  let active = -1;
  let selected = null;
  let timer = null;
  let controller = null;
  let seq = 0;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function close() {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  }

  function open() {
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function setActive(i) {
    const opts = list.querySelectorAll('[role="option"]');
    opts.forEach((o, idx) => o.setAttribute("aria-selected", idx === i ? "true" : "false"));
    active = i;
    if (i >= 0 && opts[i]) {
      input.setAttribute("aria-activedescendant", opts[i].id);
      opts[i].scrollIntoView({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function render(message) {
    if (!items.length) {
      list.innerHTML = message ? `<li class="sg-note" role="presentation">${esc(message)}</li>` : "";
      message ? open() : close();
      return;
    }
    list.innerHTML = items
      .map(
        (s, i) => `<li id="${id}-${i}" role="option" aria-selected="false" data-i="${i}">
          <span class="sg-main">${esc(s.label)}</span><span class="sg-sub">${esc(s.sub)}</span></li>`
      )
      .join("") + (message ? `<li class="sg-note" role="presentation">${esc(message)}</li>` : "");
    open();
    setActive(-1);
  }

  function choose(i) {
    const s = items[i];
    if (!s) return;
    selected = s;
    input.value = s.label;
    input.dispatchEvent(new CustomEvent("place-selected", { detail: s }));
    close();
  }

  async function search(text) {
    const mine = ++seq;
    if (controller) controller.abort();
    controller = new AbortController();
    try {
      const { items: found, remoteError } = await getSuggestions(text, controller.signal);
      if (mine !== seq) return;
      items = found;
      render(found.length ? (remoteError ? "Map search unavailable — showing built-in airports and stations only." : "") : remoteError ? "Place search is unavailable right now. Try an airport code like LHR, or “lat, lon”." : "No matches — try a city, airport code or address.");
    } catch (e) {
      if (e.name !== "AbortError" && mine === seq) {
        items = [];
        render("Place search failed. Check your connection and try again.");
      }
    }
  }

  input.addEventListener("input", () => {
    selected = null; // typing invalidates a previous pick
    clearTimeout(timer);
    const text = input.value.trim();
    if (text.length < minChars) {
      seq++;
      items = [];
      close();
      return;
    }
    timer = setTimeout(() => search(text), delay);
  });

  input.addEventListener("keydown", (e) => {
    const n = items.length;
    if (e.key === "ArrowDown" && n) {
      e.preventDefault();
      if (list.hidden) open();
      setActive((active + 1) % n);
    } else if (e.key === "ArrowUp" && n) {
      e.preventDefault();
      setActive((active - 1 + n) % n);
    } else if (e.key === "Enter" && !list.hidden && active >= 0) {
      e.preventDefault(); // pick the highlighted suggestion instead of submitting
      choose(active);
    } else if (e.key === "Escape" && !list.hidden) {
      e.preventDefault();
      close();
    }
  });

  // mousedown (not click) so the input keeps focus and blur doesn't close first
  list.addEventListener("mousedown", (e) => {
    const li = e.target.closest('[role="option"]');
    if (!li) return;
    e.preventDefault();
    choose(Number(li.dataset.i));
  });

  input.addEventListener("blur", () => setTimeout(close, 120));
  input.addEventListener("focus", () => {
    if (items.length && !selected) open();
  });

  return {
    /** The picked suggestion, if the text still matches it. */
    get place() {
      return selected && input.value === selected.label ? selected : null;
    },
    setPlace(place) {
      selected = place;
      input.value = place.label;
    },
    /** Pick explicitly, or fall back to the best match for what was typed. */
    async resolve() {
      if (this.place) return this.place;
      const text = input.value.trim();
      if (!text) throw new Error("Enter a place.");
      const { items: found } = await getSuggestions(text);
      if (!found.length) throw new Error(`Couldn't find “${text}”. Try a city, airport code, station or address.`);
      selected = found[0];
      input.value = found[0].label; // show what we used
      return found[0];
    },
  };
}

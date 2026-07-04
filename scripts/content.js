// ===== Disable page interaction =====
const prevOverflow = document.documentElement.style.overflow;
const prevUserSelect = document.documentElement.style.userSelect;

document.documentElement.style.overflow = "hidden";
document.documentElement.style.userSelect = "none";

// ===== Interaction Layer =====
const interaction = document.createElement("div");

interaction.style.cssText = `
position:fixed;
inset:0;
z-index:2147483646;
cursor:crosshair;
`;

document.body.appendChild(interaction);

// ===== Selection Box =====
const selection = document.createElement("div");

selection.style.cssText = `
position:fixed;
display:none;
box-sizing:border-box;
border:2px dashed white;
background:transparent;
pointer-events:none;
z-index:2147483648;
`;

document.body.appendChild(selection);

// ===== Overlays =====
const overlays = [];

for (let i = 0; i < 4; i++) {
  const div = document.createElement("div");

  div.style.cssText = `
    position:fixed;
    background:rgba(0,0,0,.65);
    pointer-events:none;
    z-index:2147483647;
    `;

  document.body.appendChild(div);
  overlays.push(div);
}

const [topOverlay, leftOverlay, rightOverlay, bottomOverlay] = overlays;

// Initially darken whole page
topOverlay.style.left = "0";
topOverlay.style.top = "0";
topOverlay.style.width = "100vw";
topOverlay.style.height = "100vh";

let isSelecting = false;
let startX = 0;
let startY = 0;

// ===== Mouse Down =====
interaction.addEventListener("mousedown", (e) => {

  e.preventDefault();

  isSelecting = true;

  startX = e.clientX;
  startY = e.clientY;

  selection.style.display = "block";

});

// ===== Mouse Move =====
interaction.addEventListener("mousemove", (e) => {

  if (!isSelecting) return;

  e.preventDefault();

  const currentX = e.clientX;
  const currentY = e.clientY;

  const left = Math.min(startX, currentX);
  const top = Math.min(startY, currentY);
  const width = Math.abs(currentX - startX);
  const height = Math.abs(currentY - startY);

  selection.style.left = left + "px";
  selection.style.top = top + "px";
  selection.style.width = width + "px";
  selection.style.height = height + "px";

  const W = window.innerWidth;
  const H = window.innerHeight;

  // TOP
  topOverlay.style.left = "0";
  topOverlay.style.top = "0";
  topOverlay.style.width = W + "px";
  topOverlay.style.height = top + "px";

  // LEFT
  leftOverlay.style.left = "0";
  leftOverlay.style.top = top + "px";
  leftOverlay.style.width = left + "px";
  leftOverlay.style.height = height + "px";

  // RIGHT
  rightOverlay.style.left = (left + width) + "px";
  rightOverlay.style.top = top + "px";
  rightOverlay.style.width = (W - (left + width)) + "px";
  rightOverlay.style.height = height + "px";

  // BOTTOM
  bottomOverlay.style.left = "0";
  bottomOverlay.style.top = (top + height) + "px";
  bottomOverlay.style.width = W + "px";
  bottomOverlay.style.height = (H - (top + height)) + "px";

});

// ===== Mouse Up =====
interaction.addEventListener("mouseup", (e) => {

  if (!isSelecting) return;

  e.preventDefault();

  isSelecting = false;

  const rect = selection.getBoundingClientRect();

  chrome.runtime.sendMessage({
    type: "capture",
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height
  });

  // Cleanup (comment this out if you want the UI to stay visible)
  // interaction.remove();
  // selection.remove();
  // overlays.forEach(o => o.remove());

  // document.documentElement.style.overflow = prevOverflow;
  // document.documentElement.style.userSelect = prevUserSelect;
});

// Prevent wheel scrolling
interaction.addEventListener("wheel", (e) => {
  e.preventDefault();
}, { passive: false });

// Prevent context menu
interaction.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});
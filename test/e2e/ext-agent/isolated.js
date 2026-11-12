// Isolated-world overlay (exempt from the page's CSP/Trusted Types; still visible in the DOM).
const d = document.createElement('div'); d.id = 'agent-highlight'; d.innerHTML = '<span>Agent is acting</span>';
d.style.cssText = 'position:fixed;inset:0;pointer-events:none;outline:3px solid orange;z-index:2147483647';
document.documentElement.appendChild(d);

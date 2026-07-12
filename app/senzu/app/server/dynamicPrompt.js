// Server-side port of ComfyUI's frontend "Comfy.DynamicPrompts" extension
// (shared-frontend-utils/src/formatUtil.ts -> processDynamicPrompt).
//
// ComfyUI resolves {a|b|c} dynamic prompts in the browser at queue time, so a
// workflow that works in the ComfyUI web UI produces raw, unresolved braces
// when posted straight to the /prompt API like Senzu does. We resolve it here
// instead, matching the frontend grammar: nested choices, backslash escapes and
// C-style comment stripping.
//
// Difference from the frontend: the pick RNG is seeded from the generation seed
// so a fixed seed reproduces the same prompt (and therefore the same image),
// where the frontend uses an unseeded Math.random().

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function processDynamicPrompt(input, seed = 0) {
  const rand = mulberry32(Number(seed) || 0);
  const stripped = String(input).replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

  function expand(str) {
    let i = 0;
    let result = '';

    const handleEscape = () => '\\' + str[i++];

    function parseChoiceBlock() {
      const options = [];
      let choice = '';
      let depth = 0;

      while (i < str.length) {
        const char = str[i++];
        if (char === '\\') {
          choice += handleEscape();
          continue;
        } else if (char === '{') {
          depth++;
        } else if (char === '}') {
          if (!depth) break;
          depth--;
        } else if (char === '|') {
          if (!depth) {
            options.push(choice);
            choice = '';
            continue;
          }
        }
        choice += char;
      }

      options.push(choice);
      const chosen = options[Math.floor(rand() * options.length)];
      return expand(chosen);
    }

    while (i < str.length) {
      const char = str[i++];
      if (char === '\\') {
        result += handleEscape();
      } else if (char === '{') {
        result += parseChoiceBlock();
      } else {
        result += char;
      }
    }

    return result;
  }

  return expand(stripped).replace(/\\([{}|])/g, '$1');
}

module.exports = { processDynamicPrompt };

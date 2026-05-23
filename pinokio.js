module.exports = {
  version: "3.7",
  title: "Z-Fusion",
  description: "Z-Image, Flux2 Klein, & SeedVR2 with a Gradio UI. Uses a built-in ComfyUI backend for speed and efficiency! [8GB+VRAM, 16GB+ RAM]",
  icon: "icon.png",
  menu: async (kernel, info) => {
    let installed = info.exists("app/env")
    let running = {
      install: info.running("install.js"),
      start: info.running("start.js"),
      start_pf: info.running("start_pf.js"),
      update: info.running("update.js") || info.running("_update_steps.js"),
      reset: info.running("reset.js"),
    }

    if (running.install) {
      return [{
        default: true,
        icon: "fa-solid fa-plug",
        text: "Installing",
        href: "install.js",
      }]
    } 
    else if (installed) {
      if (running.start) {
        let local = info.local("start.js")
        if (local && local.url) {
          return [{
            default: true,
            icon: "fa-solid fa-rocket",
            text: "Open Z-Fusion",
            href: local.url + "?ts=" + Date.now(),
          }, {
            icon: "fa-solid fa-diagram-project",
            text: "Open ComfyUI",
            href: "http://localhost:8188",
          }, {
            icon: "fa-solid fa-terminal",
            text: "Terminal",
            href: "start.js",
          }]
        } else {
          return [{
            default: true,
            icon: "fa-solid fa-terminal",
            text: "Terminal",
            href: "start.js",
          }]
        }
      } 
      else if (running.start_pf) {
        let local = info.local("start_pf.js")
        if (local && local.url) {
          return [{
            default: true,
            icon: "fa-solid fa-wand-magic-sparkles",
            text: "Open Senzu",
            href: local.url + "?ts=" + Date.now(),
          }, {
            icon: "fa-solid fa-diagram-project",
            text: "Open ComfyUI",
            href: "http://localhost:8188",
          }, {
            icon: "fa-solid fa-terminal",
            text: "Terminal",
            href: "start_pf.js",
          }]
        } else {
          return [{
            default: true,
            icon: "fa-solid fa-terminal",
            text: "Terminal",
            href: "start_pf.js",
          }]
        }
      }
      // Handle update running
      else if (running.update) {
        return [{
          default: true,
          icon: "fa-solid fa-terminal",
          text: "Updating",
          href: "update.js",
        }]
      } 
      else if (running.reset) {
        return [{
          default: true,
          icon: "fa-solid fa-terminal",
          text: "Resetting",
          href: "reset.js",
        }]
      } 
      else {
        return [{
          default: true,
          icon: "fa-solid fa-wand-magic-sparkles",
          text: "Start Senzu",
          href: "start_senzu.js?ts=" + Date.now(),
        }, {
          icon: "fa-solid fa-power-off",
          text: "Start Z-Fusion",
          href: "start.js?ts=" + Date.now(),
        }, {
          icon: "fa-solid fa-power-off",
          text: "Start Z-Fusion -w Optimization flags",
          menu: [{
            icon: "fa-solid fa-power-off",
            text: "<div><strong>Start</strong><br><div>+SageAttention2</div></div>",
            href: "start.js?sage=true&ts=" + Date.now(),
          }, {
            icon: "fa-solid fa-power-off",
            text: "<div><strong>Start</strong><br><div>+FlashAttention2</div></div>",
            href: "start.js?flash=true&ts=" + Date.now(),
          }],  
        }, {
          icon: "fa-solid fa-plug",
          text: "Update",
          href: "update.js",
        }, {
          icon: "fa-solid fa-plug",
          text: "Install",
          href: "install.js",
        }, {
          icon: "fa-regular fa-circle-xmark",
          text: "Reset",
          href: "reset.js",
          confirm: "Are you sure you wish to reset the app?"
        }]
      }
   } else {
      return [{
        default: true,
        icon: "fa-solid fa-plug",
        text: "Install",
        href: "install.js",
      }]
    }
  }
}
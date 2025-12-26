module.exports = {
  version: "3.7",
  title: "Z-Fusion",
  description: "Fast, high-quality image generation using comfyui via a Gradio UI",
  icon: "icon.png",
  menu: async (kernel, info) => {
    let installed = info.exists("app/env")
    let running = {
      install: info.running("install.js"),
      start: info.running("start.js"),
      update: info.running("update.js"),
      quick_update: info.running("quick_update.js"), // Added tracking
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
            text: "Open Web UI",
            href: local.url + "?ts=" + Date.now(),
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
      // Handle either update script running
      else if (running.update || running.quick_update) {
        return [{
          default: true,
          icon: "fa-solid fa-terminal",
          text: "Updating",
          href: running.update ? "update.js" : "quick_update.js",
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
          icon: "fa-solid fa-power-off",
          text: "Start",
          href: "start.js?ts=" + Date.now(),
        }, {
          icon: "fa-solid fa-power-off",
          text: "Start -w Optimization flags",
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
          // Consolidated Update Menu
          icon: "fa-solid fa-plug",
          text: "Update",
          menu: [{
            icon: "fa-solid fa-bolt",
            text: "Quick Update (Git Pull only)",
            href: "quick_update.js",
          }, {
            icon: "fa-solid fa-plug",
            text: "Full Update (Everything)",
            href: "update.js",
          }]
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
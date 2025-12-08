module.exports = {
  version: "3.7",
  title: "Z-Image Fusion",
  description: "Fast, high-quality image generation using comfyui via a Gradio UI",
  icon: "icon.png",
  menu: async (kernel, info) => {
    // Check installation state
    let installed = info.exists("app/env")
    
    // Check running states
    let running = {
      install: info.running("install.js"),
      start: info.running("start.js"),
      update: info.running("update.js"),
      reset: info.running("reset.js"),
    }

    // Installing state
    if (running.install) {
      return [{
        default: true,
        icon: "fa-solid fa-plug",
        text: "Installing",
        href: "install.js",
      }]
    } 
    // Installed states
    else if (installed) {
      // Running state
      if (running.start) {
        let local = info.local("start.js")
        if (local && local.url) {
          return [{
            default: true,
            icon: "fa-solid fa-rocket",
            text: "Open Web UI",
            href: local.url,
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
      // Updating state
      else if (running.update) {
        return [{
          default: true,
          icon: "fa-solid fa-terminal",
          text: "Updating",
          href: "update.js",
        }]
      } 
      // Resetting state
      else if (running.reset) {
        return [{
          default: true,
          icon: "fa-solid fa-terminal",
          text: "Resetting",
          href: "reset.js",
        }]
      } 
      // Installed but not running
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
    // Not installed state
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

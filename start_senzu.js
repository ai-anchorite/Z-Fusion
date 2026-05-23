module.exports = {
  daemon: true,
  run: [
    // Check for nodes added in the latest update — notify user if missing
    {
      when: "{{!exists('app/comfyui/custom_nodes/ComfyUI-JoyCaption')}}",
      method: "notify",
      params: {
        html: "<b>⚠️ One more Update needed!</b><br>Please run <b>Update once more</b> to finish installing the new nodes and workflows. This is a one-time thing!",
        type: "warning"
      }
    },
    {
      when: "{{!exists('app/comfyui/custom_nodes/ComfyUI-JoyCaption')}}",
      method: "log",
      params: {
        text: "⚠️ ONE MORE UPDATE NEEDED — Run Update once more to finish installing new nodes."
      }
    },

    // Start ComfyUI backend first
    {
      "id": "start_comfyui",
      method: "shell.run",
      params: {
        venv: "env",
        env: {
          PYTORCH_ENABLE_MPS_FALLBACK: "1",
          TOKENIZERS_PARALLELISM: "false"
        },
        path: "app",
        message: [
          "python comfyui/main.py {{platform === 'win32' && gpu === 'amd' ? '--directml' : args.sage ? '--use-sage-attention' : args.flash ? '--use-flash-attention' : ''}}"          
        ],
        on: [{
          // Wait for ComfyUI to be ready
          event: "/To see the GUI go to:\\s+(http:\\/\\/\\S+)/",
          done: true
        }, {
          // kill: true ensures ComfyUI is fully terminated before we jump back
          // to restart — prevents port 8188 conflict on the next launch
          event: "/\\[ComfyUI-Manager\\] Restarting to reapply dependency installation/",
          kill: true
        }, {
          event: "/errno/i",
          break: false
        }, {
          event: "/error:/i",
          break: false
        }]
      }
    },

    // Single conditional jump — routes to install_senzu_deps on normal startup,
    // or to manager_restart when Manager killed ComfyUI for dep installation.
    {
      method: "jump",
      params: {
        id: "{{input.event && input.event[1] ? 'install_senzu_deps' : 'manager_restart'}}"
      }
    },

    // Manager restart path — notify then loop back to relaunch ComfyUI
    {
      "id": "manager_restart",
      method: "notify",
      params: {
        html: "<b>✅ ComfyUI Manager installed new dependencies</b><br>Restarting to apply them — this will take a moment.",
        type: "info"
      }
    },
    {
      method: "jump",
      params: {
        id: "start_comfyui"
      }
    },

    // Install Senzu dependencies if not already present
    {
      "id": "install_senzu_deps",
      when: "{{!exists('app/senzu/app/node_modules')}}",
      method: "shell.run",
      params: {
        path: "app/senzu/app",
        message: [
          "npm install"
        ]
      }
    },

    // Launch the Senzu backend node application
    {
      "id": "start_senzu",
      method: "shell.run",
      params: {
        path: "app/senzu/app",
        message: [
          "node server/index.js"
        ],
        on: [{
          event: "/Senzu Backend is running on port\\s+([0-9]+)/",
          done: true
        }]
      }
    },
    // Set the local URL for Pinokio to open the SPA interface
    {
      method: "local.set",
      params: {
        url: "{{input.event && input.event[1] ? 'http://localhost:4242' : 'http://localhost:4242'}}"
      }
    }
  ]
}

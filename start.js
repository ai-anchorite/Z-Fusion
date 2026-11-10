module.exports = {
  daemon: true,
  run: [
    // Check for nodes added in the latest update — notify user if missing
    {
      when: "{{!exists('app/comfyui/custom_nodes/ComfyUI-JoyCaption')}}",
      method: "notify",
      params: {
        html: "<b>⚠️ One more Update needed!</b><br>This is a significant feature release and the updater itself was just updated.<br><br>The previous Update run fetched the new updater — please run <b>Update once more</b> to finish installing the new nodes and workflows. This is a one-time thing!",
        type: "warning"
      }
    },
    {
      when: "{{!exists('app/comfyui/custom_nodes/ComfyUI-JoyCaption')}}",
      method: "log",
      params: {
        text: "⚠️  ONE MORE UPDATE NEEDED — The updater itself was just updated. Run Update once more to finish installing new nodes. This is a one-time thing!"
      }
    },

    // Start ComfyUI backend first
    {
      "id": "start_comfyui",
      method: "shell.run",
      params: {
        venv: "venv",
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

    // Single conditional jump — routes to start_gradio on normal startup,
    // or to manager_restart when Manager killed ComfyUI for dep installation.
    // input.event[1] contains the URL on normal startup; absent on Manager restart.
    {
      method: "jump",
      params: {
        id: "{{input.event && input.event[1] ? 'start_gradio' : 'manager_restart'}}"
      }
    },

    // Manager restart path — notify then loop back to relaunch ComfyUI
    {
      "id": "manager_restart",
      method: "notify",
      params: {
        html: "<b>✅ ComfyUI Manager installed new dependencies</b><br>Restarting Z-Fusion to apply them — this will take a moment.",
        type: "info"
      }
    },
    {
      method: "jump",
      params: {
        id: "start_comfyui"
      }
    },

    // Normal startup — start Gradio app
    {
      "id": "start_gradio",
      method: "shell.run",
      params: {
        venv: "venv",
        path: "app",
        message: [
          "python app.py"
        ],
        on: [{
          event: "/Running on local URL:\\s+(http:\\/\\/[0-9.:]+)/",
          done: true
        }]
      }
    },
    // Set the Gradio URL for the "Open Web UI" button
    {
      method: "local.set",
      params: {
        url: "{{input.event[1]}}"
      }
    }
  ]
}

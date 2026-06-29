exports.plugin = {
  name: 'videoSubtitleStitch',
  displayName: '视频字幕拼接截图',
  description: '支持多次截图，将字幕区域带时间戳地拼接在首张全屏截图下方。第一次截图为完整画面，后续截图自动截取底部字幕区域并垂直拼接。',
  setup: function (params) {
    var coreApis = params.coreApis
    if (!coreApis || !coreApis.componentApis || !coreApis.componentApis.video) {
      console.error('[字幕拼接] coreApis 或 video 组件 API 不可用')
      return
    }
    var videoControlBar = coreApis.componentApis.video.videoControlBar
    var playerAgentModule = coreApis.componentApis.video.playerAgent
    var observer = coreApis.observer
    var titleUtils = coreApis.utils.title
    if (!videoControlBar || !videoControlBar.addControlBarButton) {
      console.error('[字幕拼接] videoControlBar 不可用')
      return
    }
    if (!playerAgentModule || !playerAgentModule.playerAgent) {
      console.error('[字幕拼接] playerAgent 不可用')
      return
    }

    // ── State ──────────────────────────────────────────────
    var state = {
      baseCanvas: null,
      baseTime: 0,
      stitches: [],          // [{ fullCanvas, time }]
      cropTop: 0.7,
      cropBottom: 1.0,
      panel: null,
      previewUrl: null,
      cropPreviewUrl: null,
      previewImgEl: null,
      cropPreviewImgEl: null,
      cropOverlay: null,
      cropTopLine: null,
      cropBottomLine: null,
      cropHighlight: null,
    }

    // ── Helpers ────────────────────────────────────────────
    function formatTime(time) {
      var h = Math.floor(time / 3600)
      var m = Math.floor((time % 3600) / 60)
      var s = Math.floor(time % 60)
      if (h > 0) {
        return (
          h +
          ':' +
          String(m).padStart(2, '0') +
          ':' +
          String(s).padStart(2, '0')
        )
      }
      return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
    }

    function captureFullFrame(video) {
      var canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      var ctx = canvas.getContext('2d')
      ctx.drawImage(video, 0, 0)
      return canvas
    }

    function cropCanvas(full, cropTop, cropBottom) {
      var sy = Math.floor(full.height * cropTop)
      var sh = Math.max(1, Math.floor(full.height * cropBottom) - sy)
      var regionCanvas = document.createElement('canvas')
      regionCanvas.width = full.width
      regionCanvas.height = sh
      var ctx = regionCanvas.getContext('2d')
      ctx.drawImage(
        full,
        0, sy,
        full.width, sh,
        0, 0,
        full.width, sh,
      )
      return regionCanvas
    }

    function compositeAll() {
      if (!state.baseCanvas) return null

      var labelHeight = 36
      var totalHeight = state.baseCanvas.height
      var croppedSegments = []
      var segmentPositions = []
      for (var i = 0; i < state.stitches.length; i++) {
        var cropped = cropCanvas(state.stitches[i].fullCanvas, state.cropTop, state.cropBottom)
        croppedSegments.push(cropped)
        totalHeight += labelHeight + cropped.height
      }

      var result = document.createElement('canvas')
      result.width = state.baseCanvas.width
      result.height = totalHeight
      var ctx = result.getContext('2d')

      // Draw base image
      ctx.drawImage(state.baseCanvas, 0, 0)

      var y = state.baseCanvas.height

      // Draw each subtitle segment with timestamp label
      for (var i = 0; i < croppedSegments.length; i++) {
        var stitch = state.stitches[i]
        var seg = croppedSegments[i]
        var segStartY = y

        // Timestamp label bar
        ctx.fillStyle = 'rgba(0, 0, 0, 0.85)'
        ctx.fillRect(0, y, result.width, labelHeight)
        ctx.fillStyle = '#ffffff'
        ctx.font = 'bold 24px sans-serif'
        ctx.textBaseline = 'middle'
        ctx.textAlign = 'left'
        ctx.fillText(stitch.time, 12, y + labelHeight / 2)

        // Segment number on the right
        ctx.textAlign = 'right'
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'
        ctx.fillText('#' + (i + 1), result.width - 12, y + labelHeight / 2)
        ctx.textAlign = 'left'

        y += labelHeight

        // Draw cropped subtitle region
        ctx.drawImage(seg, 0, y)
        y += seg.height

        segmentPositions.push({
          index: i,
          startY: segStartY,
          endY: y,
        })
      }

      state.segmentPositions = segmentPositions
      return result
    }

    function updatePreview() {
      if (!state.panel) return

      var composited = compositeAll()
      if (!composited) return
      var canvasHeight = composited.height
      var canvasWidth = composited.width

      composited.toBlob(function (blob) {
        if (state.previewUrl) {
          URL.revokeObjectURL(state.previewUrl)
        }
        state.previewUrl = URL.createObjectURL(blob)

        var img = state.panel.querySelector('.stitch-preview-img')
        var placeholder = state.panel.querySelector(
          '.stitch-preview-placeholder',
        )
        if (img) {
          img.src = state.previewUrl
          img.style.display = 'block'
          img.onload = function () {
            updatePreviewOverlay(canvasWidth, canvasHeight)
          }
        }
        if (placeholder) {
          placeholder.style.display = 'none'
        }

        var info = state.panel.querySelector('.stitch-info')
        if (info) {
          info.textContent =
            '基础截图: \u2713 | 字幕片段: ' + state.stitches.length
        }

        updatePreviewOverlay(canvasWidth, canvasHeight)
      }, 'image/png')
    }

    function updatePreviewOverlay(canvasW, canvasH) {
      var container = state.panel.querySelector('.stitch-preview')
      if (!container) return
      var oldOverlay = container.querySelector('.stitch-preview-overlay')
      if (oldOverlay) oldOverlay.remove()

      if (!state.segmentPositions || state.segmentPositions.length === 0) return

      var img = state.panel.querySelector('.stitch-preview-img')
      if (!img || !img.naturalWidth) return

      var containerRect = container.getBoundingClientRect()
      var imgRect = img.getBoundingClientRect()
      var imgTop = imgRect.top - containerRect.top
      var imgLeft = imgRect.left - containerRect.left
      var imgW = imgRect.width
      var imgH = imgRect.height
      var scale = imgH / canvasH

      var overlay = document.createElement('div')
      overlay.className = 'stitch-preview-overlay'

      state.segmentPositions.forEach(function (pos) {
        var zone = document.createElement('div')
        zone.className = 'stitch-preview-zone'
        zone.style.top = (imgTop + pos.startY * scale) + 'px'
        zone.style.height = ((pos.endY - pos.startY) * scale) + 'px'
        zone.style.left = imgLeft + 'px'
        zone.style.width = imgW + 'px'
        zone.title = '点击删除此片段'
        zone.onclick = function () {
          state.stitches.splice(pos.index, 1)
          updatePreview()
        }
        overlay.appendChild(zone)
      })

      container.appendChild(overlay)
    }

    function updateCropPreview() {
      if (!state.panel || !state.baseCanvas) return

      if (state.cropPreviewUrl) {
        URL.revokeObjectURL(state.cropPreviewUrl)
      }

      state.baseCanvas.toBlob(function (blob) {
        state.cropPreviewUrl = URL.createObjectURL(blob)
        var img = state.cropPreviewImgEl
        if (img) {
          img.src = state.cropPreviewUrl
          img.style.display = 'block'
          img.onload = function () {
            updateCropOverlay()
          }
        }
        var placeholder = state.panel.querySelector('.stitch-crop-placeholder')
        if (placeholder) placeholder.style.display = 'none'
        updateCropOverlay()
      }, 'image/png')
    }

    function saveComposite() {
      var composited = compositeAll()
      if (!composited) return

      composited.toBlob(function (blob) {
        var title = 'screenshot'
        try {
          title = titleUtils.getFriendlyTitle()
        } catch (e) {
          // use default
        }
        var filename = title + '_字幕拼接.png'

        var url = URL.createObjectURL(blob)
        var a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(function () {
          URL.revokeObjectURL(url)
        }, 200)
      }, 'image/png')
    }

    function reset() {
      state.baseCanvas = null
      state.baseTime = 0
      state.stitches = []
      if (state.previewUrl) {
        URL.revokeObjectURL(state.previewUrl)
        state.previewUrl = null
      }
      if (state.cropPreviewUrl) {
        URL.revokeObjectURL(state.cropPreviewUrl)
        state.cropPreviewUrl = null
      }
      if (state.panel) {
        var img = state.panel.querySelector('.stitch-preview-img')
        if (img) {
          img.src = ''
          img.style.display = 'none'
        }
        var cropImg = state.cropPreviewImgEl
        if (cropImg) {
          cropImg.src = ''
          cropImg.style.display = 'none'
        }
        var placeholder = state.panel.querySelector(
          '.stitch-preview-placeholder',
        )
        if (placeholder) placeholder.style.display = 'flex'
        var cropPlaceholder = state.panel.querySelector('.stitch-crop-placeholder')
        if (cropPlaceholder) cropPlaceholder.style.display = 'flex'
        var info = state.panel.querySelector('.stitch-info')
        if (info) info.textContent = '基础截图: \u2717 | 字幕片段: 0'
        var saveBtn = state.panel.querySelector('.stitch-btn-save')
        if (saveBtn) saveBtn.disabled = true
        var captureBtn = state.panel.querySelector('.stitch-btn-capture')
        if (captureBtn) captureBtn.disabled = true
        var overlay = state.panel.querySelector('.stitch-preview-overlay')
        if (overlay) overlay.remove()
      }
    }

    function closePanel() {
      reset()
      if (state.panel) {
        state.panel.remove()
        state.panel = null
      }
    }

    // ── Styles ─────────────────────────────────────────────
    function injectStyles() {
      if (document.getElementById('subtitle-stitch-styles')) return
      var style = document.createElement('style')
      style.id = 'subtitle-stitch-styles'
      style.textContent = [
        '.subtitle-stitch-panel {',
        '  position: fixed; top: 12px; right: 12px; z-index: 20000;',
        '  width: 320px; height: 600px; max-width: calc(100% - 24px); max-height: calc(100% - 24px);',
        '  min-width: 280px; min-height: 400px;',
        '  background: rgba(20, 20, 28, 0.95); border-radius: 12px;',
        '  box-shadow: 0 4px 20px rgba(0,0,0,0.4);',
        '  display: flex; flex-direction: column;',
        '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
        '  color: #fff; overflow: hidden; backdrop-filter: blur(10px);',
        '  resize: both;',
        '}',
        '.subtitle-stitch-header {',
        '  display: flex; align-items: center; justify-content: space-between;',
        '  padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.1);',
        '}',
        '.subtitle-stitch-title {',
        '  font-size: 14px; font-weight: 600;',
        '  display: flex; align-items: center; gap: 8px;',
        '}',
        '.subtitle-stitch-close {',
        '  background: none; border: none; color: rgba(255,255,255,0.6);',
        '  cursor: pointer; font-size: 18px; padding: 4px 8px;',
        '  border-radius: 4px; transition: all 0.2s;',
        '}',
        '.subtitle-stitch-close:hover { color: #fff; background: rgba(255,255,255,0.1); }',
        '.subtitle-stitch-body {',
        '  flex: 1; overflow-y: auto; padding: 12px 16px;',
        '}',
        '.stitch-preview {',
        '  width: 100%; background: rgba(0,0,0,0.3); border-radius: 8px;',
        '  margin-bottom: 12px; overflow: hidden;',
        '  display: flex; justify-content: center;',
        '  min-height: 80px; max-height: 400px; position: relative;',
        '}',
        '.stitch-preview-img {',
        '  max-width: 100%; max-height: 400px; object-fit: contain; display: none;',
        '}',
        '.stitch-preview-placeholder {',
        '  color: rgba(255,255,255,0.3); font-size: 12px;',
        '  display: flex; align-items: center; justify-content: center;',
        '  height: 80px; width: 100%;',
        '}',
        '.stitch-preview-overlay {',
        '  position: absolute; left: 0; right: 0; top: 0; bottom: 0;',
        '  pointer-events: none; z-index: 5;',
        '}',
        '.stitch-preview-zone {',
        '  position: absolute; cursor: pointer; pointer-events: auto;',
        '  background: rgba(255,80,80,0); transition: background 0.2s;',
        '  display: flex; align-items: center; justify-content: center;',
        '}',
        '.stitch-preview-zone:hover {',
        '  background: rgba(255,80,80,0.25);',
        '}',
        '.stitch-preview-zone::after {',
        '  content: "\u00d7"; font-size: 20px; color: #fff;',
        '  opacity: 0; transition: opacity 0.2s;',
        '  background: rgba(255,80,80,0.8); border-radius: 50%;',
        '  width: 28px; height: 28px; display: flex;',
        '  align-items: center; justify-content: center;',
        '  font-weight: bold;',
        '}',
        '.stitch-preview-zone:hover::after { opacity: 1; }',
        '.stitch-crop-preview {',
        '  width: 100%; background: rgba(0,0,0,0.3); border-radius: 8px;',
        '  margin-bottom: 8px; overflow: hidden;',
        '  display: flex; justify-content: center;',
        '  min-height: 80px; max-height: 300px; position: relative;',
        '}',
        '.stitch-crop-preview-img {',
        '  max-width: 100%; max-height: 300px; object-fit: contain; display: none;',
        '}',
        '.stitch-crop-placeholder {',
        '  color: rgba(255,255,255,0.3); font-size: 11px;',
        '  display: flex; align-items: center; justify-content: center;',
        '  height: 80px; width: 100%;',
        '}',
        '.stitch-section-label {',
        '  font-size: 11px; color: rgba(255,255,255,0.5); margin-bottom: 4px;',
        '  font-weight: 500;',
        '}',
        '.stitch-info {',
        '  font-size: 12px; color: rgba(255,255,255,0.7);',
        '  margin-bottom: 12px; text-align: center;',
        '}',
        '.stitch-controls { margin-bottom: 12px; }',
        '.stitch-crop-info {',
        '  font-size: 11px; color: rgba(255,255,255,0.6); text-align: center;',
        '  margin-bottom: 8px;',
        '}',
        '.stitch-crop-overlay {',
        '  position: absolute; left: 0; right: 0; top: 0; bottom: 0;',
        '  pointer-events: none;',
        '}',
        '.stitch-crop-line {',
        '  position: absolute; left: 0; right: 0; height: 3px;',
        '  background: #fb7299; cursor: ns-resize; pointer-events: auto;',
        '  z-index: 10; transition: background 0.15s;',
        '}',
        '.stitch-crop-line:hover, .stitch-crop-line.dragging {',
        '  background: #fc8bab; height: 4px;',
        '}',
        '.stitch-crop-line::before {',
        '  content: ""; position: absolute; left: 50%; top: 50%;',
        '  transform: translate(-50%, -50%);',
        '  width: 24px; height: 10px; border-radius: 4px;',
        '  background: rgba(251,114,153,0.9);',
        '}',
        '.stitch-crop-highlight {',
        '  position: absolute; left: 0; right: 0;',
        '  background: rgba(251,114,153,0.08);',
        '  border-top: 1px dashed rgba(251,114,153,0.4);',
        '  border-bottom: 1px dashed rgba(251,114,153,0.4);',
        '  pointer-events: none;',
        '}',
        '.stitch-buttons { display: flex; gap: 8px; margin-bottom: 12px; }',
        '.stitch-btn {',
        '  flex: 1; padding: 8px 12px; border: none; border-radius: 6px;',
        '  font-size: 12px; cursor: pointer; transition: all 0.2s;',
        '  display: flex; align-items: center; justify-content: center;',
        '  gap: 4px; font-weight: 500;',
        '}',
        '.stitch-btn-capture { background: #fb7299; color: #fff; }',
        '.stitch-btn-capture:hover:not(:disabled) { background: #fc8bab; }',
        '.stitch-btn-capture:disabled { background: rgba(251,114,153,0.3); cursor: not-allowed; }',
        '.stitch-btn-save { background: rgba(255,255,255,0.15); color: #fff; }',
        '.stitch-btn-save:hover:not(:disabled) { background: rgba(255,255,255,0.25); }',
        '.stitch-btn-save:disabled { background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.3); cursor: not-allowed; }',
        '.stitch-btn-reset { background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.8); }',
        '.stitch-btn-reset:hover { background: rgba(255,255,255,0.15); }',
      ].join('\n')
      document.head.appendChild(style)
    }

    // ── Panel ──────────────────────────────────────────────
    function createPanel() {
      injectStyles()

      var panel = document.createElement('div')
      panel.className = 'subtitle-stitch-panel'
      panel.innerHTML = [
        '<div class="subtitle-stitch-header">',
        '  <div class="subtitle-stitch-title">',
        '    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"',
        '      stroke="currentColor" stroke-width="2" stroke-linecap="round"',
        '      stroke-linejoin="round">',
        '      <rect x="2" y="2" width="20" height="8" rx="2"/>',
        '      <rect x="2" y="14" width="20" height="8" rx="2"/>',
        '      <line x1="6" y1="6" x2="6.01" y2="6"/>',
        '      <line x1="6" y1="18" x2="6.01" y2="18"/>',
        '    </svg>',
        '    \u5b57\u5e55\u62fc\u63a5\u622a\u56fe',
        '  </div>',
        '  <button class="subtitle-stitch-close" title="\u5173\u95ed">\u00d7</button>',
        '</div>',
        '<div class="subtitle-stitch-body">',
        '  <div class="stitch-section-label">\u4e3b\u4f53\u5e27 \u2014 \u62d6\u52a8\u7c89\u8272\u7ebf\u9009\u62e9\u88c1\u526a\u533a\u57df</div>',
        '  <div class="stitch-crop-preview">',
        '    <img class="stitch-crop-preview-img" />',
        '    <div class="stitch-crop-placeholder">\u622a\u56fe\u540e\u663e\u793a\u4e3b\u4f53\u5e27</div>',
        '    <div class="stitch-crop-overlay">',
        '      <div class="stitch-crop-highlight"></div>',
        '      <div class="stitch-crop-line stitch-crop-line-top"></div>',
        '      <div class="stitch-crop-line stitch-crop-line-bottom"></div>',
        '    </div>',
        '  </div>',
        '  <div class="stitch-crop-info">\u88c1\u526a\u533a\u57df: 70% ~ 100%</div>',
        '  <div class="stitch-buttons">',
        '    <button class="stitch-btn stitch-btn-capture" disabled>\u622a\u56fe</button>',
        '    <button class="stitch-btn stitch-btn-save" disabled>\u4fdd\u5b58</button>',
        '    <button class="stitch-btn stitch-btn-reset">\u91cd\u7f6e</button>',
        '  </div>',
        '  <div class="stitch-info">\u57fa\u7840\u622a\u56fe: \u2717 | \u5b57\u5e55\u7247\u6bb5: 0</div>',
        '  <div class="stitch-section-label">\u62fc\u63a5\u9884\u89c8 \u2014 \u70b9\u51fb\u7247\u6bb5\u53ef\u5220\u9664</div>',
        '  <div class="stitch-preview">',
        '    <img class="stitch-preview-img" />',
        '    <div class="stitch-preview-placeholder">\u70b9\u51fb\u622a\u56fe\u6309\u94ae\u5f00\u59cb</div>',
        '  </div>',
        '</div>',
      ].join('')

      document.body.appendChild(panel)
      state.panel = panel

      // Event listeners
      panel.querySelector('.subtitle-stitch-close').onclick = closePanel
      panel.querySelector('.stitch-btn-reset').onclick = reset
      panel.querySelector('.stitch-btn-save').onclick = saveComposite
      panel.querySelector('.stitch-btn-capture').onclick = function () {
        takeStitchScreenshot()
      }

      // Crop overlay setup (on crop preview, not composited preview)
      state.previewImgEl = panel.querySelector('.stitch-preview-img')
      state.cropPreviewImgEl = panel.querySelector('.stitch-crop-preview-img')
      state.cropOverlay = panel.querySelector('.stitch-crop-overlay')
      state.cropTopLine = panel.querySelector('.stitch-crop-line-top')
      state.cropBottomLine = panel.querySelector('.stitch-crop-line-bottom')
      state.cropHighlight = panel.querySelector('.stitch-crop-highlight')

      setupCropDrag()
    }

    function updateCropOverlay() {
      if (!state.cropOverlay || !state.cropPreviewImgEl) return
      var img = state.cropPreviewImgEl
      if (img.style.display === 'none' || !img.naturalWidth) return

      var container = img.parentElement
      var containerRect = container.getBoundingClientRect()
      var imgRect = img.getBoundingClientRect()

      var imgTop = imgRect.top - containerRect.top
      var imgHeight = imgRect.height

      var topPx = imgTop + imgHeight * state.cropTop
      var bottomPx = imgTop + imgHeight * state.cropBottom

      if (state.cropTopLine) {
        state.cropTopLine.style.top = topPx + 'px'
      }
      if (state.cropBottomLine) {
        state.cropBottomLine.style.top = bottomPx + 'px'
      }
      if (state.cropHighlight) {
        state.cropHighlight.style.top = topPx + 'px'
        state.cropHighlight.style.height = (bottomPx - topPx) + 'px'
      }

      var info = state.panel.querySelector('.stitch-crop-info')
      if (info) {
        info.textContent = '裁剪区域: ' +
          Math.round(state.cropTop * 100) + '% ~ ' +
          Math.round(state.cropBottom * 100) + '%'
      }
    }

    function setupCropDrag() {
      function makeDraggable(line, isTop) {
        line.addEventListener('mousedown', function (e) {
          e.preventDefault()
          e.stopPropagation()
          line.classList.add('dragging')
          var container = state.cropPreviewImgEl.parentElement
          var containerRect = container.getBoundingClientRect()
          var imgRect = state.cropPreviewImgEl.getBoundingClientRect()
          var imgTop = imgRect.top - containerRect.top
          var imgHeight = imgRect.height

          function onMove(ev) {
            var y = ev.clientY - containerRect.top - imgTop
            var ratio = Math.max(0, Math.min(1, y / imgHeight))
            if (isTop) {
              state.cropTop = Math.min(ratio, state.cropBottom - 0.02)
            } else {
              state.cropBottom = Math.max(ratio, state.cropTop + 0.02)
            }
            updateCropOverlay()
          }
          function onUp() {
            line.classList.remove('dragging')
            document.removeEventListener('mousemove', onMove)
            document.removeEventListener('mouseup', onUp)
            // Re-composite all segments with new crop region
            updatePreview()
          }
          document.addEventListener('mousemove', onMove)
          document.addEventListener('mouseup', onUp)
        })
      }
      if (state.cropTopLine) makeDraggable(state.cropTopLine, true)
      if (state.cropBottomLine) makeDraggable(state.cropBottomLine, false)
    }

    // ── Screenshot Action ──────────────────────────────────
    async function takeStitchScreenshot() {
      var playerAgent = playerAgentModule.playerAgent
      var video = await playerAgent.query.video.element()
      if (!(video instanceof HTMLVideoElement) || video.videoWidth === 0) {
        console.error('[字幕拼接] 无法定位视频元素或视频未加载')
        return
      }

      try {
        if (!state.baseCanvas) {
          state.baseCanvas = captureFullFrame(video)
          state.baseTime = video.currentTime

          if (!state.panel) {
            createPanel()
          }

          updatePreview()
          updateCropPreview()

          var saveBtn = state.panel.querySelector('.stitch-btn-save')
          if (saveBtn) saveBtn.disabled = false
          var captureBtn = state.panel.querySelector('.stitch-btn-capture')
          if (captureBtn) captureBtn.disabled = false
        } else {
          var full = captureFullFrame(video)
          state.stitches.push({
            fullCanvas: full,
            time: formatTime(video.currentTime),
            timeValue: video.currentTime,
          })
          state.stitches.sort(function (a, b) {
            return a.timeValue - b.timeValue
          })
          updatePreview()
        }
      } catch (err) {
        console.error('[字幕拼接] 截图失败:', err)
      }
    }

    // ── Register Control Bar Button ────────────────────────
    videoControlBar.addControlBarButton({
      name: 'subtitleStitch',
      displayName: '字幕拼接',
      icon: 'mdi-image-multiple',
      order: 0,
      action: takeStitchScreenshot,
    }).catch(function (err) {
      console.error('[字幕拼接] 控制栏按钮注册失败:', err)
    })

    // ── Reset on Video Change ─────────────────────────────
    if (observer && observer.videoChange) {
      observer.videoChange(function () {
        if (state.baseCanvas) {
          reset()
        }
      })
    }
  },
}

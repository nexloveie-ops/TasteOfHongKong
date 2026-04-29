import { useCallback, useRef, useState, useEffect } from 'react';

interface ARViewerProps {
  arFileUrl: string;
  itemName?: string;
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent);
}

/**
 * ARViewer component — opens AR experience for a menu item.
 *
 * - iOS: uses `<a rel="ar">` to launch AR Quick Look with the USDZ file.
 * - Android: attempts to load `<model-viewer>` web component; falls back to a direct link.
 * - Triggered by tap / long-press on the AR icon (🔮).
 */
export default function ARViewer({ arFileUrl, itemName = 'Item' }: ARViewerProps) {
  const [showViewer, setShowViewer] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iosLinkRef = useRef<HTMLAnchorElement | null>(null);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    };
  }, []);

  const openAR = useCallback(() => {
    if (isIOS() && iosLinkRef.current) {
      // Programmatically click the hidden iOS AR link
      iosLinkRef.current.click();
    } else {
      setShowViewer(true);
    }
  }, []);

  const handlePointerDown = useCallback(() => {
    longPressTimer.current = setTimeout(() => {
      openAR();
    }, 500);
  }, [openAR]);

  const handlePointerUp = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleTap = useCallback(() => {
    openAR();
  }, [openAR]);

  return (
    <>
      {/* AR trigger icon */}
      <span
        role="button"
        aria-label={`View ${itemName} in AR`}
        tabIndex={0}
        style={{ fontSize: 14, cursor: 'pointer', userSelect: 'none' }}
        onClick={handleTap}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') openAR();
        }}
      >
        🔮
      </span>

      {/* Hidden iOS AR Quick Look link */}
      <a
        ref={iosLinkRef}
        rel="ar"
        href={arFileUrl}
        style={{ display: 'none' }}
        aria-hidden="true"
      >
        <img src="" alt="" />
      </a>

      {/* Android / fallback overlay viewer */}
      {showViewer && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
          onClick={() => setShowViewer(false)}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 12,
              padding: 20,
              maxWidth: 360,
              width: '90%',
              textAlign: 'center',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 12px' }}>{itemName} — AR Preview</h3>

            {isAndroid() ? (
              /* model-viewer for Android */
              <model-viewer
                src={arFileUrl}
                alt={`${itemName} 3D model`}
                ar
                ar-modes="webxr scene-viewer quick-look"
                camera-controls
                style={{ width: '100%', height: 260 }}
              />
            ) : (
              /* Generic fallback: direct download / open link */
              <div>
                <p style={{ fontSize: 14, color: '#555', marginBottom: 12 }}>
                  Tap the button below to view the 3D model.
                </p>
                <a
                  href={arFileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-block',
                    padding: '10px 24px',
                    background: '#1976d2',
                    color: '#fff',
                    borderRadius: 6,
                    textDecoration: 'none',
                    fontWeight: 600,
                  }}
                >
                  Open 3D Model
                </a>
              </div>
            )}

            <button
              onClick={() => setShowViewer(false)}
              style={{
                marginTop: 16,
                padding: '8px 24px',
                border: '1px solid #ccc',
                borderRadius: 6,
                background: '#f5f5f5',
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}

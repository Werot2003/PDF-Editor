import { useCallback, useEffect, useRef, useState } from 'react';

const MIN_BOX_SIZE = 0.02;

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));

function getPagePointsHeight(item) {
  if (item.height > 0 && item.pdfHeight > 0) {
    return item.pdfHeight / item.height;
  }

  return 842;
}

/**
 * @param {string} toolMode - 'editText' | 'moveText' | null
 */
export default function TextOverlay({
  items,
  toolMode,
  pageSize,
  fontFamily,
  onTextUpdate,
  selectedId,
  setSelectedId,
  editingId,
  setEditingId,
}) {
  const layerRef = useRef(null);
  const actionRef = useRef(null);

  const isEditMode = toolMode === 'editText';
  const isMoveMode = toolMode === 'moveText';
  const isActive = isEditMode || isMoveMode;

  const patchItem = useCallback((id, patch) => {
    onTextUpdate(id, (item) => ({
      ...item,
      ...patch,
    }));
  }, [onTextUpdate]);

  // Clear editing state when switching away from editText mode
  useEffect(() => {
    if (!isEditMode && editingId) {
      setEditingId(null);
    }
  }, [isEditMode, editingId, setEditingId]);

  // Clear selection when switching away from any text tool
  useEffect(() => {
    if (!isActive && selectedId) {
      setSelectedId(null);
    }
  }, [isActive, selectedId, setSelectedId]);

  useEffect(() => {
    const handlePointerMove = (event) => {
      if (!actionRef.current || !layerRef.current) return;

      const rect = layerRef.current.getBoundingClientRect();
      const { id, kind, startX, startY, original } = actionRef.current;
      const dx = (event.clientX - startX) / rect.width;
      const dy = (event.clientY - startY) / rect.height;

      onTextUpdate(id, (item) => {
        if (kind === 'move') {
          const newX = clamp(original.x + dx, 0, 1 - item.width);
          const newY = clamp(original.y + dy, 0, 1 - item.height);
          const posChanged = newX !== original.x || newY !== original.y;
          return {
            ...item,
            x: newX,
            y: newY,
            isModified: posChanged || item.currentText !== item.originalText,
          };
        }

        let nextX = original.x;
        let nextY = original.y;
        let nextWidth = original.width;
        let nextHeight = original.height;

        if (kind.includes('e')) {
          nextWidth = clamp(original.width + dx, MIN_BOX_SIZE, 1 - original.x);
        }

        if (kind.includes('s')) {
          nextHeight = clamp(original.height + dy, MIN_BOX_SIZE, 1 - original.y);
        }

        if (kind.includes('w')) {
          const maxDx = original.width - MIN_BOX_SIZE;
          const safeDx = clamp(dx, -original.x, maxDx);
          nextX = original.x + safeDx;
          nextWidth = original.width - safeDx;
        }

        if (kind.includes('n')) {
          const maxDy = original.height - MIN_BOX_SIZE;
          const safeDy = clamp(dy, -original.y, maxDy);
          nextY = original.y + safeDy;
          nextHeight = original.height - safeDy;
        }

        return {
          ...item,
          x: nextX,
          y: nextY,
          width: nextWidth,
          height: nextHeight,
          isModified: (nextX !== original.x || nextY !== original.y || nextWidth !== original.width || nextHeight !== original.height) || item.currentText !== item.originalText,
        };
      });
    };

    const handlePointerUp = () => {
      actionRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [onTextUpdate]);

  if (!items || items.length === 0) return null;

  const startAction = (event, item, kind) => {
    // Only allow drag/resize in moveText mode
    if (!isMoveMode || editingId === item.id) return;

    event.preventDefault();
    event.stopPropagation();
    setSelectedId(item.id);

    actionRef.current = {
      id: item.id,
      kind,
      startX: event.clientX,
      startY: event.clientY,
      original: item,
    };
  };

  return (
    <div
      ref={layerRef}
      className="text-overlay-layer"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: isActive ? 'auto' : 'none',
        zIndex: isActive ? 15 : 5,
      }}
    >
      {items.map((item) => {
        const renderedFontSize = item.fontSize * (pageSize.height / getPagePointsHeight(item));
        const isSelected = selectedId === item.id;
        const isEditing = editingId === item.id;

        return (
          <TextOverlayItem
            key={item.id}
            item={item}
            isEditMode={isEditMode}
            isMoveMode={isMoveMode}
            isActive={isActive}
            isSelected={isSelected}
            isEditing={isEditing}
            renderedFontSize={renderedFontSize}
            fontFamily={fontFamily}
            onSelect={() => setSelectedId(item.id)}
            onStartAction={startAction}
            onStartEditing={() => {
              if (!isEditMode) return;
              setSelectedId(item.id);
              setEditingId(item.id);
            }}
            onStopEditing={() => setEditingId(null)}
            onPatch={patchItem}
          />
        );
      })}
    </div>
  );
}

function TextOverlayItem({
  item,
  isEditMode,
  isMoveMode,
  isActive,
  isSelected,
  isEditing,
  renderedFontSize,
  fontFamily,
  onSelect,
  onStartAction,
  onStartEditing,
  onStopEditing,
  onPatch,
}) {
  const editRef = useRef(null);

  // When entering edit mode, set text content via ref (not React children)
  // This avoids the React contentEditable DOM reconciliation crash.
  useEffect(() => {
    if (isEditing && editRef.current) {
      editRef.current.textContent = item.currentText;
      editRef.current.focus();

      // Select all text
      try {
        const range = document.createRange();
        range.selectNodeContents(editRef.current);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      } catch {
        // ignore selection errors
      }
    }
    // Only trigger on isEditing change, not on every text update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing]);

  const handleInput = (event) => {
    const nextText = event.currentTarget.textContent || '';
    onPatch(item.id, {
      currentText: nextText,
      isModified: nextText !== item.originalText,
    });
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }
    event.stopPropagation();
  };

  // Determine cursor based on mode
  let cursor = 'default';
  if (isEditing) cursor = 'text';
  else if (isMoveMode) cursor = 'move';
  else if (isEditMode) cursor = 'text';

  const commonStyle = {
    position: 'absolute',
    left: `${item.x * 100}%`,
    top: `${item.y * 100}%`,
    width: `${item.width * 100}%`,
    height: `${item.height * 100}%`,
    fontSize: `${Math.max(8, renderedFontSize)}px`,
    lineHeight: 1.15,
    letterSpacing: '0px',
    fontFamily: fontFamily || item.fontFamily || 'sans-serif',
    whiteSpace: 'pre-wrap',
    boxSizing: 'border-box',
    padding: '1px 3px',
  };

  return (
    <>
      {/* Display layer — React-managed, never contentEditable */}
      <div
        role="button"
        tabIndex={0}
        className={`text-overlay-item${isActive ? ' text-overlay-interactive' : ''}${isSelected ? ' text-overlay-selected' : ''}${item.isModified ? ' text-overlay-modified' : ''}`}
        style={{
          ...commonStyle,
          overflow: 'hidden',
          outline: isSelected ? '2px solid #8b5cf6' : (isActive ? '1px dashed rgba(139, 92, 246, 0.55)' : 'none'),
          background: item.isModified ? 'rgba(255,255,255,0.88)' : (isActive ? 'rgba(255,255,255,0.18)' : 'transparent'),
          cursor,
          userSelect: 'none',
          // Hide behind editing overlay when editing
          visibility: isEditing ? 'hidden' : 'visible',
        }}
        onPointerDown={(event) => {
          if (isMoveMode) {
            onStartAction(event, item, 'move');
          }
        }}
        onClick={(event) => {
          if (!isActive) return;
          event.stopPropagation();
          onSelect();
        }}
        onDoubleClick={(event) => {
          if (!isEditMode) return;
          event.stopPropagation();
          onStartEditing();
        }}
      >
        {item.currentText}

        {/* Resize handles only in moveText mode */}
        {isMoveMode && isSelected && (
          <>
            {['nw', 'ne', 'sw', 'se'].map((handle) => (
              <button
                key={handle}
                type="button"
                aria-label={`resize-${handle}`}
                className="absolute h-4 w-4 rounded-full border-2 border-white bg-accent-400 shadow-lg"
                style={{
                  top: handle.includes('n') ? '-8px' : undefined,
                  right: handle.includes('e') ? '-8px' : undefined,
                  bottom: handle.includes('s') ? '-8px' : undefined,
                  left: handle.includes('w') ? '-8px' : undefined,
                  cursor: `${handle}-resize`,
                }}
                onPointerDown={(event) => onStartAction(event, item, handle)}
              />
            ))}
          </>
        )}
      </div>

      {/* Editing layer — ref-managed, contentEditable, separate from React tree */}
      {isEditing && (
        <div
          ref={editRef}
          contentEditable
          suppressContentEditableWarning
          className="text-overlay-item text-overlay-editing"
          style={{
            ...commonStyle,
            overflow: 'auto',
            outline: '2px solid #8b5cf6',
            cursor: 'text',
            userSelect: 'text',
            zIndex: 20,
          }}
          onBlur={() => onStopEditing()}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        />
      )}
    </>
  );
}

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X } from 'lucide-react';

export interface ComboOption {
  value: string;
  label: string;
  subLabel?: string;
}

interface SearchableComboProps {
  value: string;
  onChange: (val: string) => void;
  options: ComboOption[];
  placeholder?: string;
  allowCustom?: boolean;
  dark?: boolean;
  disabled?: boolean;
  className?: string;
}

export const SearchableCombo: React.FC<SearchableComboProps> = ({
  value,
  onChange,
  options,
  placeholder = '-- Chọn hoặc nhập để tìm --',
  allowCustom = true,
  dark = false,
  disabled = false,
  className = '',
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selectedLabel = useMemo(() => {
    const valLow = String(value || '').trim().toLowerCase();
    const found =
      options.find((o) => o.value === value) ||
      (valLow ? options.find((o) => o.value.trim().toLowerCase() === valLow) : undefined);
    return found ? found.label : value || '';
  }, [options, value]);

  useEffect(() => {
    if (!open) {
      setQuery(selectedLabel);
    }
  }, [selectedLabel, open]);

  const updateMenuPosition = useCallback(() => {
    const anchor = wrapRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;
    const maxMenuH = 264;
    const spaceBelow = viewportH - rect.bottom - 10;
    const spaceAbove = rect.top - 10;
    const openUpward = spaceBelow < 180 && spaceAbove > spaceBelow;
    const computedMaxH = Math.max(120, Math.min(maxMenuH, openUpward ? spaceAbove : spaceBelow));
    const menuWidth = Math.max(rect.width, 200);
    const left = Math.min(Math.max(8, rect.left), Math.max(8, viewportW - menuWidth - 8));

    setMenuStyle({
      position: 'fixed',
      left: `${left}px`,
      width: `${menuWidth}px`,
      maxHeight: `${computedMaxH}px`,
      zIndex: 9999,
      ...(openUpward
        ? { bottom: `${Math.max(8, viewportH - rect.top + 4)}px`, top: 'auto' }
        : { top: `${rect.bottom + 4}px`, bottom: 'auto' }),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
    const onScrollOrResize = () => updateMenuPosition();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const inWrap = wrapRef.current?.contains(target);
      const inMenu = menuRef.current?.contains(target);
      if (!inWrap && !inMenu) {
        if (allowCustom) {
          const trimmed = query.trim();
          const matchedOpt = options.find(
            (o) =>
              o.label.trim().toLowerCase() === trimmed.toLowerCase() ||
              o.value.trim().toLowerCase() === trimmed.toLowerCase()
          );
          const committed = matchedOpt ? matchedOpt.value : trimmed;
          if (committed !== value) onChange(committed);
        }
        setOpen(false);
        if (!allowCustom) {
          setQuery(selectedLabel);
        }
      }
    };
    document.addEventListener('mousedown', handleOutside, true);
    return () => document.removeEventListener('mousedown', handleOutside, true);
  }, [selectedLabel, allowCustom, open, query, options, value, onChange]);

  const filtered = useMemo(() => {
    const q = open && query !== selectedLabel ? query.trim().toLowerCase() : '';
    if (!q) return options.slice(0, 120);
    return options
      .filter(
        (o) =>
          o.label.toLowerCase().includes(q) ||
          o.value.toLowerCase().includes(q) ||
          (o.subLabel || '').toLowerCase().includes(q)
      )
      .slice(0, 120);
  }, [options, query, open, selectedLabel]);

  useEffect(() => {
    setHighlightIdx(0);
  }, [query, open]);

  const trimmedQuery = query.trim();
  const hasExact = options.some(
    (o) =>
      o.value.trim().toLowerCase() === trimmedQuery.toLowerCase() ||
      o.label.trim().toLowerCase() === trimmedQuery.toLowerCase()
  );

  const selectOption = (opt: ComboOption) => {
    onChange(opt.value);
    setQuery(opt.label);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (e.key === 'Escape') {
      setOpen(false);
      if (!allowCustom) setQuery(selectedLabel);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setHighlightIdx((prev) => (filtered.length > 0 ? (prev + 1) % filtered.length : 0));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setHighlightIdx((prev) => (filtered.length > 0 ? (prev - 1 + filtered.length) % filtered.length : 0));
      return;
    }
    if (e.key === 'Enter' && open) {
      e.preventDefault();
      if (filtered[highlightIdx]) {
        selectOption(filtered[highlightIdx]);
      } else if (allowCustom && trimmedQuery) {
        onChange(trimmedQuery);
        setQuery(trimmedQuery);
        setOpen(false);
      }
    }
  };

  const dropdownPortal =
    open && !disabled && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={menuRef}
            style={menuStyle}
            className={`overflow-y-auto overscroll-contain rounded-xl border-2 shadow-2xl ${
              dark
                ? 'bg-[#07281c] border-[#f4d98a] text-[#fff5d6]'
                : 'bg-[#f4fbf7] border-[#0f4a33] text-[#07281c]'
            }`}
          >
            {filtered.map((opt, idx) => {
              const active = opt.value === value;
              const highlighted = idx === highlightIdx;
              return (
                <button
                  key={`${opt.value}::${opt.label}::${idx}`}
                  type="button"
                  onMouseEnter={() => setHighlightIdx(idx)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectOption(opt);
                  }}
                  className={`w-full text-left px-3 py-2 text-xs border-b last:border-b-0 transition-colors flex flex-col cursor-pointer ${
                    dark
                      ? `border-[#186635]/60 ${
                          highlighted
                            ? 'bg-[#16977f] text-white'
                            : active
                            ? 'bg-[#0f4a33] text-[#f4d98a] font-bold'
                            : 'text-[#fff5d6]'
                        }`
                      : `border-[#186635]/20 ${
                          highlighted
                            ? 'bg-[#0f4a33] text-[#fff5d6]'
                            : active
                            ? 'bg-[#9bccb8] text-[#07281c] font-bold'
                            : 'text-[#07281c]'
                        }`
                  }`}
                >
                  <span className="font-semibold leading-snug">{opt.label}</span>
                  {opt.subLabel && (
                    <span
                      className={`text-[10.5px] leading-snug ${
                        highlighted ? 'text-[#f4d98a]' : 'opacity-80'
                      }`}
                    >
                      {opt.subLabel}
                    </span>
                  )}
                </button>
              );
            })}
            {allowCustom && trimmedQuery && !hasExact && (
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(trimmedQuery);
                  setQuery(trimmedQuery);
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-xs font-extrabold bg-[#f4d98a] text-[#07281c] hover:bg-[#e7c463] cursor-pointer"
              >
                Dùng giá trị nhập: &quot;{trimmedQuery}&quot;
              </button>
            )}
            {filtered.length === 0 && (!allowCustom || !trimmedQuery) && (
              <div className="px-3 py-2.5 text-xs opacity-75 italic">
                Không tìm thấy lựa chọn phù hợp
              </div>
            )}
          </div>,
          document.body
        )
      : null;

  return (
    <div ref={wrapRef} className={`relative overflow-visible ${className}`}>
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          type="text"
          disabled={disabled}
          value={open ? query : selectedLabel}
          placeholder={placeholder}
          onFocus={() => {
            if (disabled) return;
            setOpen(true);
            setQuery(allowCustom ? selectedLabel : '');
          }}
          onClick={() => {
            if (disabled) return;
            if (!open) {
              setOpen(true);
              setQuery(allowCustom ? selectedLabel : '');
            }
          }}
          onKeyDown={handleKeyDown}
          onChange={(e) => {
            const nextVal = e.target.value;
            setQuery(nextVal);
            if (allowCustom) {
              onChange(nextVal);
            }
            if (!open) setOpen(true);
          }}
          className={`w-full ${value && !disabled ? 'pr-14' : 'pr-8'} pl-3 py-1.5 text-xs sm:text-[13px] font-semibold rounded-lg border-[1.5px] outline-none transition-colors ${
            dark
              ? 'bg-[#0b3324] border-[#2f7d3e] text-[#fff5d6] placeholder:text-[#9bccb8]/55 placeholder:italic placeholder:font-normal focus:border-[#f4d98a]'
              : 'bg-[#d7eee4] border-[#186635] text-[#0b2418] placeholder:text-[#0b2418]/44 placeholder:italic placeholder:font-normal focus:bg-white'
          } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
        />
        {value && !disabled && (
          <button
            type="button"
            tabIndex={-1}
            title="Xóa lựa chọn"
            onMouseDown={(e) => {
              e.preventDefault();
              onChange('');
              setQuery('');
              setOpen(false);
            }}
            className={`absolute right-7 p-1 rounded cursor-pointer ${
              dark ? 'text-[#d2ebe0] hover:text-[#f4d98a]' : 'text-[#0f4a33] hover:text-[#8c3b3b]'
            }`}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onMouseDown={(e) => {
            e.preventDefault();
            if (disabled) return;
            if (open) {
              setOpen(false);
              if (!allowCustom) setQuery(selectedLabel);
            } else {
              setOpen(true);
              setQuery('');
              inputRef.current?.focus();
            }
          }}
          className={`absolute right-1.5 p-1 cursor-pointer ${dark ? 'text-[#f4d98a]' : 'text-[#0f4a33]'}`}
        >
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {dropdownPortal}
    </div>
  );
};

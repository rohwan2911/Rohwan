import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  const wrapRef = useRef<HTMLDivElement>(null);

  const selectedLabel = useMemo(() => {
    const found = options.find((o) => o.value === value);
    return found ? found.label : value || '';
  }, [options, value]);

  useEffect(() => {
    if (!open) {
      setQuery(selectedLabel);
    }
  }, [selectedLabel, open]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        if (allowCustom && open) {
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
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [selectedLabel, allowCustom, open, query, options, value, onChange]);

  const filtered = useMemo(() => {
    const q = open && query !== selectedLabel ? query.trim().toLowerCase() : '';
    if (!q) return options.slice(0, 80);
    return options
      .filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q) || (o.subLabel || '').toLowerCase().includes(q))
      .slice(0, 80);
  }, [options, query, open, selectedLabel]);

  const trimmedQuery = query.trim();
  const hasExact = options.some(
    (o) =>
      o.value.trim().toLowerCase() === trimmedQuery.toLowerCase() ||
      o.label.trim().toLowerCase() === trimmedQuery.toLowerCase()
  );

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <div className="relative flex items-center">
        <input
          type="text"
          disabled={disabled}
          value={open ? query : selectedLabel}
          placeholder={placeholder}
          onFocus={() => {
            if (disabled) return;
            setOpen(true);
            setQuery(allowCustom ? selectedLabel : '');
          }}
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
              ? 'bg-[#0b3324] border-[#2f7d3e] text-[#fff5d6] placeholder-[#9bccb8]/60 focus:border-[#f4d98a]'
              : 'bg-[#d7eee4] border-[#186635] text-[#0b2418] placeholder-[#1e4231]/60 focus:bg-white'
          } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
        />
        {value && !disabled && (
          <button
            type="button"
            tabIndex={-1}
            title="Xóa lựa chọn"
            onClick={() => {
              onChange('');
              setQuery('');
              setOpen(false);
            }}
            className={`absolute right-7 p-1 rounded cursor-pointer ${dark ? 'text-[#d2ebe0] hover:text-[#f4d98a]' : 'text-[#0f4a33] hover:text-[#8c3b3b]'}`}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={() => {
            if (disabled) return;
            setOpen((prev) => !prev);
            if (!open) setQuery('');
          }}
          className={`absolute right-1.5 p-1 cursor-pointer ${dark ? 'text-[#f4d98a]' : 'text-[#0f4a33]'}`}
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>

      {open && !disabled && (
        <div
          className={`absolute left-0 right-0 mt-1 max-h-60 overflow-y-auto rounded-xl border-2 shadow-xl z-50 ${
            dark
              ? 'bg-[#07281c] border-[#f4d98a]/70 text-[#fff5d6]'
              : 'bg-[#e6f5ee] border-[#186635] text-[#0b2418]'
          }`}
        >
          {filtered.map((opt) => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value + '::' + opt.label}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setQuery(opt.label);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-xs border-b last:border-b-0 transition-colors flex flex-col ${
                  dark
                    ? `border-[#186635]/50 hover:bg-[#16977f] hover:text-white ${active ? 'bg-[#0f4a33] text-[#f4d98a] font-bold' : ''}`
                    : `border-[#186635]/20 hover:bg-[#2d583f] hover:text-white ${active ? 'bg-[#9bccb8] font-bold' : ''}`
                }`}
              >
                <span>{opt.label}</span>
                {opt.subLabel && <span className="text-[10.5px] opacity-80">{opt.subLabel}</span>}
              </button>
            );
          })}
          {allowCustom && trimmedQuery && !hasExact && (
            <button
              type="button"
              onClick={() => {
                onChange(trimmedQuery);
                setQuery(trimmedQuery);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-xs font-bold bg-[#f4d98a] text-[#07281c] hover:bg-[#e7c463]"
            >
              Dùng giá trị nhập: "{trimmedQuery}"
            </button>
          )}
          {filtered.length === 0 && !allowCustom && (
            <div className="px-3 py-2 text-xs opacity-70 italic">Không tìm thấy lựa chọn phù hợp</div>
          )}
        </div>
      )}
    </div>
  );
};

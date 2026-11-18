import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ChevronDown, Search, X, Check } from 'lucide-react';
import { OdbRecord, OnuRecord, ZoneRecord } from '../services/mockDatabase';

interface SearchableSplitterSelectProps {
  value: number | 'NONE';
  onChange: (val: number | 'NONE') => void;
  splitters: OdbRecord[];
  onus: OnuRecord[];
  zones: ZoneRecord[];
  disabled?: boolean;
  noneLabel?: string;
  maxVisibleItems?: number;
  className?: string;
}

export const SearchableSplitterSelect: React.FC<SearchableSplitterSelectProps> = ({
  value,
  onChange,
  splitters,
  onus,
  zones,
  disabled = false,
  noneLabel = 'None',
  maxVisibleItems = 10,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Precompute used port count per ODP
  const usedCountMap = useMemo(() => {
    const map = new Map<number, number>();
    for (const u of onus) {
      if (u.is_authorized && u.odb_id !== null) {
        map.set(u.odb_id, (map.get(u.odb_id) || 0) + 1);
      }
    }
    return map;
  }, [onus]);

  const zoneNameMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const z of zones) {
      map.set(z.id, z.name);
    }
    return map;
  }, [zones]);

  const selectedObj = useMemo(
    () => (value === 'NONE' ? null : splitters.find((o) => o.id === value) || null),
    [splitters, value]
  );

  const formatLabel = (o: OdbRecord) => {
    const used = usedCountMap.get(o.id) || 0;
    const zName = o.zone_id ? zoneNameMap.get(o.zone_id) : undefined;
    return `${o.name} (${o.splitter_ratio} · ${used}/${o.total_ports} ports used${
      zName ? ` · ${zName}` : ''
    })`;
  };

  const filteredSplitters = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return splitters;
    return splitters.filter((o) => {
      const zName = (o.zone_id ? zoneNameMap.get(o.zone_id) : '') || '';
      return (
        o.name.toLowerCase().includes(q) ||
        (o.pole_number || '').toLowerCase().includes(q) ||
        o.splitter_ratio.toLowerCase().includes(q) ||
        zName.toLowerCase().includes(q)
      );
    });
  }, [splitters, searchTerm, zoneNameMap]);

  // Strictly show max 10 ODP items
  const visibleSplitters = useMemo(
    () => filteredSplitters.slice(0, maxVisibleItems),
    [filteredSplitters, maxVisibleItems]
  );

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 20);
    } else {
      setSearchTerm('');
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs transition ${
          isOpen
            ? 'border-sky-400 bg-slate-950 ring-2 ring-sky-400/20'
            : 'border-slate-700 bg-slate-950 hover:border-slate-600'
        } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} text-white`}
      >
        <span className="truncate">
          {selectedObj ? formatLabel(selectedObj) : noneLabel}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${
            isOpen ? 'rotate-180 text-sky-400' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div className="absolute left-0 right-0 z-50 mt-1.5 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
          {/* Search Input */}
          <div className="border-b border-slate-800 bg-slate-950/90 p-2">
            <div className="relative flex items-center">
              <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Cari ODP / Splitter (nama, tiang, zone)..."
                className="w-full rounded-lg border border-slate-700 bg-slate-900 py-1.5 pl-8 pr-7 text-xs text-white placeholder-slate-500 focus:border-sky-400 focus:outline-none"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm('');
                    searchInputRef.current?.focus();
                  }}
                  className="absolute right-2 text-slate-400 hover:text-white"
                  title="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Max 10 ODP List */}
          <div className="max-h-64 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => {
                onChange('NONE');
                setIsOpen(false);
              }}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition ${
                value === 'NONE'
                  ? 'bg-sky-600/20 font-semibold text-sky-300'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <span className="truncate">{noneLabel}</span>
              {value === 'NONE' && <Check className="h-3.5 w-3.5 shrink-0 text-sky-400" />}
            </button>

            {visibleSplitters.length === 0 ? (
              <div className="px-3 py-4 text-center text-[11px] text-slate-400">
                ODP / Splitter tidak ditemukan untuk &quot;{searchTerm}&quot;
              </div>
            ) : (
              visibleSplitters.map((o) => {
                const isSelected = value === o.id;
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => {
                      onChange(o.id);
                      setIsOpen(false);
                    }}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition ${
                      isSelected
                        ? 'bg-sky-600/20 font-semibold text-sky-300'
                        : 'text-slate-200 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <span className="truncate">{formatLabel(o)}</span>
                    {isSelected && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Cap Indicator Footer */}
          <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950/80 px-3 py-1.5 text-[10px] text-slate-400">
            <span>
              Menampilkan {visibleSplitters.length} dari {filteredSplitters.length} ODP
            </span>
            {filteredSplitters.length > maxVisibleItems && (
              <span className="text-sky-400">Ketik untuk mencari ODP lainnya</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

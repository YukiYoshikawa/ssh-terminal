import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, ChevronUp, ChevronDown, X } from 'lucide-react';
import { searchBuffer } from '../core/keygen';
import styles from './SearchBar.module.css';

interface SearchBarProps {
  visible: boolean;
  onClose: () => void;
  getBuffer: () => string;
}

interface SearchMatch {
  line: number;
  start: number;
  end: number;
  text: string;
}

export function SearchBar({ visible, onClose, getBuffer }: SearchBarProps) {
  const [pattern, setPattern] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus input when search bar becomes visible
  useEffect(() => {
    if (visible) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [visible]);

  const runSearch = useCallback(
    async (value: string, cs: boolean) => {
      if (!value) {
        setMatches([]);
        setCurrentIndex(0);
        return;
      }
      try {
        const buffer = getBuffer();
        // If not regex mode, escape special regex characters
        const effectivePattern = useRegex ? value : value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const results = await searchBuffer(buffer, effectivePattern, cs);
        setMatches(results);
        setCurrentIndex(results.length > 0 ? 0 : -1);
      } catch {
        setMatches([]);
        setCurrentIndex(-1);
      }
    },
    [getBuffer, useRegex],
  );

  const handlePatternChange = (value: string) => {
    setPattern(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      runSearch(value, caseSensitive);
    }, 300);
  };

  const handleCaseSensitiveToggle = () => {
    const next = !caseSensitive;
    setCaseSensitive(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      runSearch(pattern, next);
    }, 0);
  };

  const handleRegexToggle = () => {
    setUseRegex((prev) => !prev);
    // Re-run search after state update
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      runSearch(pattern, caseSensitive);
    }, 0);
  };

  const goNext = () => {
    if (matches.length === 0) return;
    setCurrentIndex((prev) => (prev + 1) % matches.length);
  };

  const goPrev = () => {
    if (matches.length === 0) return;
    setCurrentIndex((prev) => (prev - 1 + matches.length) % matches.length);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter') {
      if (e.shiftKey) {
        goPrev();
      } else {
        goNext();
      }
      e.preventDefault();
    }
  };

  const handleClose = () => {
    setPattern('');
    setMatches([]);
    setCurrentIndex(0);
    onClose();
  };

  if (!visible) return null;

  const countLabel =
    matches.length === 0
      ? pattern
        ? '一致なし'
        : ''
      : `${currentIndex >= 0 ? currentIndex + 1 : 0}/${matches.length} 件`;

  return (
    <div className={styles.bar}>
      <div className={styles.searchIcon}>
        <Search size={14} />
      </div>
      <input
        ref={inputRef}
        className={styles.input}
        type="text"
        placeholder="検索... (Enter: 次, Shift+Enter: 前)"
        value={pattern}
        onChange={(e) => handlePatternChange(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      {countLabel && (
        <span className={`${styles.count} ${matches.length === 0 && pattern ? styles.noMatch : ''}`}>
          {countLabel}
        </span>
      )}
      <button
        className={`${styles.iconBtn} ${caseSensitive ? styles.active : ''}`}
        onClick={handleCaseSensitiveToggle}
        title="大文字/小文字を区別"
        aria-label="大文字/小文字を区別"
      >
        Aa
      </button>
      <button
        className={`${styles.iconBtn} ${useRegex ? styles.active : ''}`}
        onClick={handleRegexToggle}
        title="正規表現"
        aria-label="正規表現"
      >
        .*
      </button>
      <button
        className={styles.iconBtn}
        onClick={goPrev}
        disabled={matches.length === 0}
        title="前の一致 (Shift+Enter)"
        aria-label="前の一致"
      >
        <ChevronUp size={14} />
      </button>
      <button
        className={styles.iconBtn}
        onClick={goNext}
        disabled={matches.length === 0}
        title="次の一致 (Enter)"
        aria-label="次の一致"
      >
        <ChevronDown size={14} />
      </button>
      <button
        className={styles.closeBtn}
        onClick={handleClose}
        title="閉じる (Esc)"
        aria-label="検索を閉じる"
      >
        <X size={14} />
      </button>
    </div>
  );
}

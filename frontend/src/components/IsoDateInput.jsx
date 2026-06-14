import React, { useRef } from 'react';
import { Calendar } from 'lucide-react';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const IsoDateInput = ({
  value = '',
  onValueChange,
  className = '',
  wrapperClassName = '',
  buttonClassName = '',
  iconSize = 14,
  placeholder = 'YYYY-MM-DD',
  title = 'Select date',
  ...inputProps
}) => {
  const pickerRef = useRef(null);
  const textValue = String(value || '');
  const pickerValue = ISO_DATE_RE.test(textValue.trim()) ? textValue.trim() : '';

  const openPicker = () => {
    const picker = pickerRef.current;
    if (!picker) return;
    if (typeof picker.showPicker === 'function') {
      picker.showPicker();
    } else {
      picker.click();
    }
  };

  return (
    <div className={`relative ${wrapperClassName}`}>
      <input
        {...inputProps}
        type="text"
        value={textValue}
        onChange={(event) => onValueChange?.(event.target.value)}
        placeholder={placeholder}
        pattern="\d{4}-\d{2}-\d{2}"
        className={className}
      />
      <button
        type="button"
        onClick={openPicker}
        className={`absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-primary ${buttonClassName}`}
        title={title}
        aria-label={title}
      >
        <Calendar size={iconSize} />
      </button>
      <input
        ref={pickerRef}
        type="date"
        value={pickerValue}
        onChange={(event) => onValueChange?.(event.target.value)}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  );
};

export default IsoDateInput;

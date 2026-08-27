"use client";

import { X } from "lucide-react";
import Select from "@/components/app/Select";

export type TagSelectOption = {
  value: string;
  label: string;
};

export default function TagSelect({
  tags,
  onChange,
  options,
  placeholder,
  addLabel,
  disabled = false,
  max,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  options: TagSelectOption[];
  placeholder: string;
  addLabel: string;
  disabled?: boolean;
  max?: number;
}) {
  const labelByValue = new Map(options.map((option) => [option.value, option.label]));
  const available = options.filter((option) => !tags.includes(option.value));
  const atMax = max !== undefined && tags.length >= max;

  function add(value: string) {
    if (!value || tags.includes(value)) return;
    if (max !== undefined && tags.length >= max) return;
    onChange([...tags, value]);
  }

  function remove(value: string) {
    onChange(tags.filter((tag) => tag !== value));
  }

  return (
    <div className="space-y-2">
      <div
        className="flex min-h-9 flex-wrap gap-1.5 rounded-md border border-input bg-transparent px-3 py-2 text-sm"
        aria-live="polite"
      >
        {tags.length === 0 ? (
          <span className="text-xs text-muted-foreground">{placeholder}</span>
        ) : (
          tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-md bg-foreground px-2 py-0.5 text-xs font-medium text-background"
            >
              {labelByValue.get(tag) ?? tag}
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Remove ${labelByValue.get(tag) ?? tag}`}
                  onClick={() => remove(tag)}
                  className="-m-1 p-1.5 transition-opacity hover:opacity-70"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))
        )}
      </div>
      <Select
        disabled={disabled || atMax || available.length === 0}
        value=""
        onChange={(event) => add(event.target.value)}
      >
        <option value="">{addLabel}</option>
        {available.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

// src/components/RGemSelectorModal.tsx
import React, { useState } from "react";
import { isValidGemId } from "../lib/gem-id";

export type RGemSelectorModalProps = {
  onSubmit: (gemId: string) => void;
  isConnecting: boolean;
  error?: string | null;
};

/**
 * RGemSelectorModal
 *
 * A modal for entering a Gem ID and initiating a connection.
 * It does NOT know anything about grid state or WebSockets.
 * Connection errors are sourced from history.state on mount (set by App.tsx on failure).
 */
export const RGemSelectorModal: React.FC<RGemSelectorModalProps> = ({
  onSubmit,
  isConnecting,
  error,
}) => {
  // NOTE: Initialize from history.state on mount to pre-populate input and show a contextual
  // error after a failed connection attempt. App.tsx sets this state via history.replaceState
  // before redirecting back to /. Using lazy useState initializers avoids setState-in-effect.
  const [inputValue, setInputValue] = useState<string>(() => {
    const state = window.history.state as { gemId?: unknown; error?: unknown } | null;
    return state?.error === "connection_failed" && typeof state?.gemId === "string"
      ? state.gemId
      : "";
  });
  const [validationError, setValidationError] = useState<string | null>(null);
  const [connectionError] = useState<string | null>(() => {
    const state = window.history.state as { gemId?: unknown; error?: unknown } | null;
    if (state?.error === "connection_failed" && typeof state?.gemId === "string") {
      return `Could not connect to '${state.gemId}'. Check the ID and try again.`;
    }
    if (state?.error === "invalid_gem_id") {
      return "Gem ID can only contain letters, numbers, and hyphens (max 24 characters)";
    }
    return null;
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    setValidationError(null);
  };

  const handleSubmit = () => {
    const trimmed = inputValue.trim();
    if (!isValidGemId(trimmed)) {
      setValidationError(
        "Gem ID can only contain letters, numbers, and hyphens (max 24 characters)"
      );
      return;
    }
    onSubmit(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSubmit();
    }
  };

  // Priority: inline validation error > external routing error (prop) > connection error (history.state)
  const displayError = validationError ?? error ?? connectionError;
  const canConnect = inputValue.trim().length > 0 && !validationError && !isConnecting;

  return (
    <div className="rgem-modal-backdrop" aria-modal="true" role="dialog">
      <div className="rgem-modal">
        <h2 className="rgem-modal-title">Connect to an RGEM</h2>

        <label className="rgem-modal-label">
          Gem ID:
          <input
            type="text"
            className="rgem-modal-input"
            value={inputValue}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            disabled={isConnecting}
            placeholder="e.g. test-1"
          />
        </label>

        {displayError && <p className="rgem-modal-error">{displayError}</p>}

        <button
          type="button"
          className="rgem-modal-button"
          onClick={handleSubmit}
          disabled={!canConnect}
        >
          {isConnecting ? "Connecting..." : "Connect"}
        </button>
      </div>
    </div>
  );
};

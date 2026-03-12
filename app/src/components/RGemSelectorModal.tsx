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
 */
export const RGemSelectorModal: React.FC<RGemSelectorModalProps> = ({
  onSubmit,
  isConnecting,
  error,
}) => {
  const [inputValue, setInputValue] = useState<string>("");
  const [validationError, setValidationError] = useState<string | null>(null);

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

  const displayError = validationError ?? error;
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

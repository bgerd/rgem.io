// src/components/RGemSelectorModal.tsx
import React from "react";

export type RGemSelectorModalProps = {
  rgemIds: string[];
  selectedRgemId: string | null;
  onSelectRgemId: (id: string) => void;
  onConnect: () => void;
  isConnecting: boolean;
  error?: string | null;
};

/**
 * RGemSelectorModal
 *
 * A simple, stateless modal for choosing an RGEM ID and initiating a connection.
 * It does NOT know anything about grid state or WebSockets.
 */
export const RGemSelectorModal: React.FC<RGemSelectorModalProps> = ({
  rgemIds,
  selectedRgemId,
  onSelectRgemId,
  onConnect,
  isConnecting,
  error,
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value || null;
    if (value) {
      onSelectRgemId(value);
    }
  };

  const canConnect = !!selectedRgemId && !isConnecting;

  return (
    <div className="rgem-modal-backdrop" aria-modal="true" role="dialog">
      <div className="rgem-modal">
        <h2 className="rgem-modal-title">Connect to an RGEM</h2>

        <label className="rgem-modal-label">
          Select RGEM:
          <select
            className="rgem-modal-select"
            value={selectedRgemId ?? ""}
            onChange={handleChange}
            disabled={isConnecting}
          >
            <option value="">-- Choose an RGEM --</option>
            {rgemIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>

        {error && <p className="rgem-modal-error">{error}</p>}

        <button
          type="button"
          className="rgem-modal-button"
          onClick={onConnect}
          disabled={!canConnect}
        >
          {isConnecting ? "Connecting..." : "Connect"}
        </button>
      </div>
    </div>
  );
};

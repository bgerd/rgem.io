// src/components/LoadingOverlay.tsx
import React from "react";

export type LoadingOverlayProps = {
  isVisible: boolean;
  message?: string;
};

/**
 * Full-screen loading overlay with a simple spinner.
 * Used while "connecting" so the user knows something is happening.
 */
export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({
  isVisible,
  message = "Connecting…",
}) => {
  if (!isVisible) return null;

  return (
    <div className="rgem-loading-overlay" aria-live="polite">
      <div className="rgem-loading-content">
        <div className="rgem-spinner" />
        <p className="rgem-loading-message">{message}</p>
      </div>
    </div>
  );
};

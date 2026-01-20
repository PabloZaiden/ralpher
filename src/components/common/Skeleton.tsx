/**
 * Skeleton loading components for displaying loading placeholders.
 */

import type { HTMLAttributes } from "react";

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** Width of the skeleton (default: 100%) */
  width?: string | number;
  /** Height of the skeleton (default: 1rem) */
  height?: string | number;
  /** Whether the skeleton is rounded (pill shape) */
  rounded?: boolean;
  /** Whether the skeleton is a circle */
  circle?: boolean;
}

/**
 * Base skeleton component for loading placeholders.
 */
export function Skeleton({
  width = "100%",
  height = "1rem",
  rounded = false,
  circle = false,
  className = "",
  style,
  ...props
}: SkeletonProps) {
  const widthStyle = typeof width === "number" ? `${width}px` : width;
  const heightStyle = typeof height === "number" ? `${height}px` : height;

  return (
    <div
      className={`animate-pulse bg-gray-200 dark:bg-gray-700 ${circle ? "rounded-full" : rounded ? "rounded-full" : "rounded"} ${className}`}
      style={{
        width: circle ? heightStyle : widthStyle,
        height: heightStyle,
        ...style,
      }}
      {...props}
    />
  );
}

export interface SkeletonTextProps {
  /** Number of lines to display */
  lines?: number;
  /** Class name for the container */
  className?: string;
}

/**
 * Text skeleton with multiple lines.
 */
export function SkeletonText({ lines = 3, className = "" }: SkeletonTextProps) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          height="0.875rem"
          width={i === lines - 1 ? "60%" : "100%"}
        />
      ))}
    </div>
  );
}

export interface SkeletonCardProps {
  /** Whether to show an image placeholder */
  showImage?: boolean;
  /** Number of text lines */
  textLines?: number;
  /** Class name for the container */
  className?: string;
}

/**
 * Card-shaped skeleton for loading cards.
 */
export function SkeletonCard({
  showImage = false,
  textLines = 3,
  className = "",
}: SkeletonCardProps) {
  return (
    <div
      className={`rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 ${className}`}
    >
      {showImage && (
        <Skeleton height={160} className="mb-4" />
      )}
      <Skeleton height="1.5rem" width="60%" className="mb-4" />
      <SkeletonText lines={textLines} />
    </div>
  );
}

export interface SkeletonLoopCardProps {
  /** Class name for the container */
  className?: string;
}

/**
 * Loop card skeleton matching the LoopCard component structure.
 */
export function SkeletonLoopCard({ className = "" }: SkeletonLoopCardProps) {
  return (
    <div
      className={`rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 ${className}`}
    >
      {/* Header: Badge + Name */}
      <div className="flex items-start justify-between mb-3">
        <Skeleton height="1.25rem" width="70%" />
        <Skeleton height="1.5rem" width="4rem" rounded />
      </div>

      {/* Directory */}
      <Skeleton height="0.875rem" width="90%" className="mb-3" />

      {/* Stats row */}
      <div className="flex gap-4 mb-4">
        <Skeleton height="0.875rem" width="4rem" />
        <Skeleton height="0.875rem" width="4rem" />
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <Skeleton height="2rem" width="4rem" />
        <Skeleton height="2rem" width="4rem" />
      </div>
    </div>
  );
}

export interface SkeletonLoopDetailsProps {
  /** Class name for the container */
  className?: string;
}

/**
 * Loop details skeleton matching the LoopDetails component structure.
 */
export function SkeletonLoopDetails({ className = "" }: SkeletonLoopDetailsProps) {
  return (
    <div className={`max-w-6xl mx-auto p-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Skeleton height="2.5rem" width="2.5rem" rounded />
        <Skeleton height="2rem" width="200px" />
        <Skeleton height="1.5rem" width="80px" rounded />
      </div>

      {/* Stats row */}
      <div className="flex gap-6 mb-6">
        <Skeleton height="1rem" width="6rem" />
        <Skeleton height="1rem" width="6rem" />
        <Skeleton height="1rem" width="8rem" />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4 border-b border-gray-200 dark:border-gray-700 pb-2">
        <Skeleton height="2rem" width="4rem" />
        <Skeleton height="2rem" width="4rem" />
        <Skeleton height="2rem" width="4rem" />
        <Skeleton height="2rem" width="4rem" />
      </div>

      {/* Content area */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        <SkeletonText lines={10} />
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 mt-4">
        <Skeleton height="2.5rem" width="6rem" />
        <Skeleton height="2.5rem" width="6rem" />
        <Skeleton height="2.5rem" width="6rem" />
      </div>
    </div>
  );
}

export default Skeleton;

import numpy as np
from typing import Tuple, Optional


def index_gamma_zero(levels: np.ndarray, total_gamma: np.ndarray) -> Optional[float]:
    """
    Calculate the index gamma zero (strike level where gamma crosses zero).

    Uses linear interpolation between the strikes where gamma sign changes.

    Args:
        levels: Array of strike prices
        total_gamma: Array of gamma values corresponding to each strike

    Returns:
        Strike price where gamma equals zero, or None if no zero crossing found

    Example:
        levels = np.array([4400, 4410, 4420, 4430])
        gamma = np.array([-0.002, -0.001, 0.001, 0.002])
        zero_strike = index_gamma_zero(levels, gamma)
        # Returns approximately 4420
    """
    # Find sign changes in gamma
    sign_changes = np.diff(np.sign(total_gamma))

    # Find indices where sign actually changes (non-zero diff)
    zero_cross_indices = np.where(sign_changes != 0)[0]

    if len(zero_cross_indices) == 0:
        return None

    # Use the first zero crossing
    zero_cross_idx = zero_cross_indices[0]

    neg_gamma = total_gamma[zero_cross_idx]
    pos_gamma = total_gamma[zero_cross_idx + 1]
    neg_strike = levels[zero_cross_idx]
    pos_strike = levels[zero_cross_idx + 1]

    # Linear interpolation: solve for x where gamma = 0
    zero_gamma = neg_strike - (neg_gamma * (pos_strike - neg_strike) / (pos_gamma - neg_gamma))

    return zero_gamma


def find_all_gamma_zeros(levels: np.ndarray, total_gamma: np.ndarray) -> list:
    """
    Find all strike prices where gamma crosses zero.

    Args:
        levels: Array of strike prices
        total_gamma: Array of gamma values corresponding to each strike

    Returns:
        List of strike prices where gamma equals zero
    """
    sign_changes = np.diff(np.sign(total_gamma))
    zero_cross_indices = np.where(sign_changes != 0)[0]

    zeros = []
    for zero_cross_idx in zero_cross_indices:
        neg_gamma = total_gamma[zero_cross_idx]
        pos_gamma = total_gamma[zero_cross_idx + 1]
        neg_strike = levels[zero_cross_idx]
        pos_strike = levels[zero_cross_idx + 1]

        zero_gamma = neg_strike - (neg_gamma * (pos_strike - neg_strike) / (pos_gamma - neg_gamma))
        zeros.append(zero_gamma)

    return zeros


if __name__ == "__main__":
    # Example usage
    levels = np.array([4400, 4410, 4420, 4430, 4440])
    gamma = np.array([-0.003, -0.001, 0.0005, 0.002, 0.004])

    zero = index_gamma_zero(levels, gamma)
    print(f"Index gamma zero: {zero:.2f}")

    # Find all zeros
    all_zeros = find_all_gamma_zeros(levels, gamma)
    print(f"All gamma zeros: {all_zeros}")

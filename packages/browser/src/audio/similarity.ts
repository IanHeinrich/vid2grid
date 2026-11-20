function norm(vector: ArrayLike<number>): number {
  let sumOfSquares = 0;
  for (let index = 0; index < vector.length; index++) {
    const value = vector[index] ?? 0;
    sumOfSquares += value * value;
  }
  return Math.sqrt(sumOfSquares);
}

export function unitVector(vector: ArrayLike<number>): Float32Array {
  const length = norm(vector);
  return Float32Array.from({ length: vector.length }, (_, index) =>
    length > 0 ? (vector[index] ?? 0) / length : 0,
  );
}

// Each vector counts equally whatever its length, so no one wording outweighs the others.
export function meanDirection(vectors: readonly ArrayLike<number>[]): Float32Array {
  const width = vectors[0]?.length ?? 0;
  const sum = new Float32Array(width);
  for (const vector of vectors) {
    const unit = unitVector(vector);
    for (let index = 0; index < width; index++) {
      sum[index] = (sum[index] ?? 0) + (unit[index] ?? 0);
    }
  }
  return unitVector(sum);
}

export function similarityLogits(
  audioEmbedding: ArrayLike<number>,
  labelEmbeddings: readonly ArrayLike<number>[],
  scale: number,
): number[] {
  const audioNorm = norm(audioEmbedding);
  return labelEmbeddings.map((labelEmbedding) => {
    let dot = 0;
    for (let index = 0; index < audioEmbedding.length; index++) {
      dot += (audioEmbedding[index] ?? 0) * (labelEmbedding[index] ?? 0);
    }
    const scaleDown = audioNorm * norm(labelEmbedding);
    return scaleDown > 0 ? (scale * dot) / scaleDown : 0;
  });
}

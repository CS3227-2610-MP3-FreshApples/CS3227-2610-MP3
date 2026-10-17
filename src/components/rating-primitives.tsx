type RatingValueProps = Readonly<{
  value: number;
}>;

export function RatingValue({ value }: RatingValueProps) {
  return <span aria-label={`Rating ${value} out of 10`}>{value}/10</span>;
}

type AggregateRatingProps = Readonly<{
  average: number | null;
  count: number;
  emptyLabel: string;
}>;

export function AggregateRating({ average, count, emptyLabel }: AggregateRatingProps) {
  if (average === null || count === 0) {
    return <span aria-label={emptyLabel}>{emptyLabel}</span>;
  }

  return <span aria-label={`Average rating ${average.toFixed(1)} out of 10 from ${count} ratings`}>{average.toFixed(1)}/10</span>;
}

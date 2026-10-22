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

  const displayAverage = (Math.trunc(average * 10) / 10).toFixed(1);
  return <span aria-label={`Average rating ${displayAverage} out of 10 from ${count} ratings`}>{displayAverage}/10</span>;
}

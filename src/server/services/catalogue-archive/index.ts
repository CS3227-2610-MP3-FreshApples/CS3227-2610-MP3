import "server-only";

// The Catalogue archive/restore orchestrator (P-12). It depends on Catalogue core and on K8, so it is a
// separate module that Catalogue core never imports: Reviews → Catalogue core stays free of cycles.
export { createMovieArchiveService } from "./movie-archive";
export type { MovieArchiveDependencies, MovieArchiveService, ReviewsOfMovieLock } from "./movie-archive";

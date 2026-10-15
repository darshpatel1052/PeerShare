# Build and understand PeerShare

Start with a real user journey, then follow its components, API and data model.

| Product journey                                | Learn the implementation                                                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Create an account and channel                  | [Identity, SQL and Go foundations](learning/phase-1/README.md)                                                          |
| Upload, preview and publish a video            | [Media publishing](learning/phase-2/README.md)                                                                          |
| Produce adaptive playback in separate services | [Go, gRPC, Kafka and FFmpeg](learning/phase-3/README.md)                                                                |
| Follow creators and organize playlists         | [Viewer library and search](learning/phase-4/01-library-and-search.md)                                                  |
| Understand creator playback and delivery       | [Analytics](learning/phase-4/02-playback-and-analytics.md)                                                              |
| Add artwork and Google sign-in                 | [Creator settings and OIDC](learning/product-and-google/README.md)                                                      |
| Understand the complete frontend               | [Design system and components](learning/ui-design.md)                                                                   |
| Manage processing across the platform          | [Operator workspace](learning/phase-6/05-operator-workspace.md)                                                         |
| Run it on AWS                                  | [Deployment architecture](learning/phase-5/README.md)                                                                   |
| Explain measured performance in an interview   | [Benchmark report](benchmarks/report.md) and [measurement concepts](learning/phase-6/04-benchmarking-a-video-system.md) |

For a hands-on demonstration, use the [creator/viewer walkthrough](runbooks/demo-and-handoff.md). The README and learning guides describe current features first. Detailed reliability decisions, recovery procedures and historical evidence remain available in the ADRs, runbooks and evidence folders when you need to investigate how those features behave under failure.

PeerShare is the current product and repository name. The original supplied brief and immutable measurement/review records retain their historical PeerScreen names and source commits. Existing storage, cookie, environment and wire-protocol identifiers remain compatible with the deployed data.

// Original editorial material. These are showcase channels, not customer identities.
export const series = [
  {
    slug: "go-field-notes",
    title: "Go Field Notes",
    accent: "#79b9ff",
    shade: "#10253d",
    motif: "nodes",
    description:
      "Small, visual explanations of Go. An original PeerScreen showcase series.",
    videos: [
      {
        slug: "goroutines",
        title: "Concurrency without the chaos",
        tag: "Go",
        chapters: [
          [
            "Start small. Run concurrently.",
            "A goroutine runs a function independently.",
            "The Go runtime schedules many goroutines onto OS threads.",
          ],
          [
            "Share work through channels.",
            "A channel carries typed values between goroutines.",
            "Senders and receivers can coordinate without shared mutation.",
          ],
          [
            "Always define the exit.",
            "Use context cancellation when work is no longer needed.",
            "The function that starts work should know how it stops.",
          ],
          [
            "Concurrency is a tool.",
            "Parallel execution depends on available CPU cores.",
            "Use it for independent work, then measure the result.",
          ],
        ],
      },
      {
        slug: "context",
        title: "How a request knows when to stop",
        tag: "Go",
        chapters: [
          [
            "Every request has a lifetime.",
            "Context carries a cancellation signal and deadline.",
            "Pass it from the HTTP handler into database and RPC calls.",
          ],
          [
            "A deadline is a budget.",
            "Downstream work shares the caller's remaining time.",
            "Do not give every dependency a fresh unlimited timeout.",
          ],
          [
            "Cancellation is cooperative.",
            "A function must observe ctx.Done() or use a context-aware API.",
            "Stopping a caller does not undo a committed database write.",
          ],
          [
            "Keep cleanup predictable.",
            "Call cancel to release timers and related resources.",
            "Keep request values small and limited to request metadata.",
          ],
        ],
      },
      {
        slug: "middleware",
        title: "One request, one useful trail",
        tag: "APIs",
        chapters: [
          [
            "Start at the HTTP boundary.",
            "Assign a request ID before calling the handler.",
            "Record the route, response status and elapsed time.",
          ],
          [
            "Wrap a ResponseWriter.",
            "Capture the status and the bytes actually written.",
            "Keep normal handler behaviour intact.",
          ],
          [
            "Use a route template.",
            "Group /videos/{id} as one metric series.",
            "Do not create a metric label for every user or video.",
          ],
          [
            "Follow the right signals.",
            "Logs explain individual events; metrics show trends.",
            "Traces connect the calls made by one operation.",
          ],
        ],
      },
    ],
  },
  {
    slug: "systems-atelier",
    title: "Systems Atelier",
    accent: "#ff9973",
    shade: "#382018",
    motif: "queue",
    description:
      "Queues, messages and the work between services. An original PeerScreen showcase series.",
    videos: [
      {
        slug: "outbox",
        title: "Why your queue needs an outbox",
        tag: "Systems",
        chapters: [
          [
            "Two writes, one problem.",
            "Saving a job and publishing a message are separate operations.",
            "A crash between them can leave valid work undispatched.",
          ],
          [
            "Save the intent together.",
            "Write the job and an outbox record in one SQL transaction.",
            "They become visible together when the transaction commits.",
          ],
          [
            "Let a relay deliver it.",
            "A background relay publishes pending outbox records.",
            "It marks delivery after the broker acknowledges the message.",
          ],
          [
            "Expect duplicates.",
            "The relay may publish twice after losing an acknowledgement.",
            "Consumers need idempotency rather than an exactly-once claim.",
          ],
        ],
      },
      {
        slug: "idempotency",
        title: "Retry a request without doing it twice",
        tag: "APIs",
        chapters: [
          [
            "A timeout is ambiguous.",
            "The server may have committed before the response was lost.",
            "Blindly repeating a create request can create duplicates.",
          ],
          [
            "Give the intent a key.",
            "The client keeps one idempotency key for the same operation.",
            "The server stores it with a fingerprint of the request.",
          ],
          [
            "Resolve it atomically.",
            "Look up or create the operation inside a transaction.",
            "The same key and payload return the existing result.",
          ],
          [
            "Different payload, same key?",
            "Return a conflict instead of changing the original operation.",
            "A new intent needs a new key.",
          ],
        ],
      },
      {
        slug: "leases",
        title: "Who owns a job after a worker disappears?",
        tag: "Systems",
        chapters: [
          [
            "Ownership has an expiry.",
            "A worker claims a job with a time-limited lease.",
            "Heartbeats extend that lease while work continues.",
          ],
          [
            "A lost worker stops renewing.",
            "Another worker can claim the job after the lease expires.",
            "The queue message alone is not proof of ownership.",
          ],
          [
            "Fence an old attempt.",
            "Each claim receives a newer attempt epoch.",
            "Completion is accepted only for the current valid owner.",
          ],
          [
            "Keep outputs immutable.",
            "Write each attempt to its own output directory.",
            "Only accepted output becomes the video's playback version.",
          ],
        ],
      },
    ],
  },
  {
    slug: "frame-by-frame",
    title: "Frame by Frame",
    accent: "#bd9aff",
    shade: "#271b40",
    motif: "frames",
    description:
      "The mechanics behind a better watch experience. An original PeerScreen showcase series.",
    videos: [
      {
        slug: "adaptive-hls",
        title: "From MP4 to adaptive HLS",
        tag: "Video",
        chapters: [
          [
            "One source, several renditions.",
            "The worker validates the uploaded MP4 with FFprobe.",
            "FFmpeg encodes source-appropriate 480p and 720p outputs.",
          ],
          [
            "Cut a stream into segments.",
            "A media playlist names short chunks of video.",
            "The browser fetches them as playback needs them.",
          ],
          [
            "Describe available qualities.",
            "A master playlist links the rendition playlists.",
            "The player can select a quality without downloading the source.",
          ],
          [
            "Publish only when ready.",
            "Validate manifests and actual segment files first.",
            "The published record points at one accepted output version.",
          ],
        ],
      },
      {
        slug: "peer-path",
        title: "How video finds another viewer",
        tag: "WebRTC",
        chapters: [
          [
            "Start with a clear choice.",
            "Peer sharing stays off until the viewer opts in.",
            "Normal HTTP delivery remains available.",
          ],
          [
            "Find viewers of the same version.",
            "A tracker exchanges connection signalling.",
            "Peers must agree on the video, version and rendition.",
          ],
          [
            "Discover a network path.",
            "STUN helps a browser learn connection candidates.",
            "Some network combinations require a TURN relay.",
          ],
          [
            "Verify the bytes you receive.",
            "Check each segment against its SHA-256 descriptor.",
            "Use HTTP when a peer cannot deliver valid media.",
          ],
        ],
      },
      {
        slug: "first-frame",
        title: "What happens before the first frame",
        tag: "Playback",
        chapters: [
          [
            "Load the playback description.",
            "Resolve the accepted version and its integrity descriptor.",
            "Fetch the master and selected media playlist.",
          ],
          [
            "Fill a small buffer.",
            "Download enough verified video data to begin decoding.",
            "The first frame depends on network, codec and device work.",
          ],
          [
            "Keep startup and stalls separate.",
            "Startup measures play request to first playback.",
            "Rebuffering measures interruptions after playback begins.",
          ],
          [
            "Measure an actual player.",
            "An HTTP response time does not prove video decoded.",
            "Use playback progress and visible player events as evidence.",
          ],
        ],
      },
    ],
  },
  {
    slug: "data-workshop",
    title: "Data Workshop",
    accent: "#c5e778",
    shade: "#23301b",
    motif: "bars",
    description:
      "Practical database decisions, drawn clearly. An original PeerScreen showcase series.",
    videos: [
      {
        slug: "cursor-pagination",
        title: "A feed that remembers where you left off",
        tag: "PostgreSQL",
        chapters: [
          [
            "Order the feed consistently.",
            "Sort by publication time, then by a unique ID.",
            "The ID resolves ties between equal timestamps.",
          ],
          [
            "Carry a position, not an offset.",
            "A cursor contains the last seen ordering values.",
            "The next page requests rows after that position.",
          ],
          [
            "Index the same ordering.",
            "A matching feed index avoids counting every skipped row.",
            "Only include rows visible in the published catalogue.",
          ],
          [
            "Keep the contract bounded.",
            "Validate the cursor and limit the page size.",
            "Return a next cursor only when more rows exist.",
          ],
        ],
      },
      {
        slug: "indexes",
        title: "The index your query actually needs",
        tag: "PostgreSQL",
        chapters: [
          [
            "Start with a real query.",
            "Look at its filters, ordering and expected result size.",
            "An index is useful only when the planner can use it.",
          ],
          [
            "Read the execution plan.",
            "EXPLAIN ANALYZE shows actual rows and execution time.",
            "Compare estimated rows with the rows really scanned.",
          ],
          [
            "Different work needs different indexes.",
            "A B-tree helps ordered equality/range access.",
            "A GIN index can help a full-text search document.",
          ],
          [
            "Keep the cost in view.",
            "Indexes consume storage and add work to writes.",
            "Measure the workload before and after adding one.",
          ],
        ],
      },
      {
        slug: "transactions",
        title: "Where a transaction earns its place",
        tag: "Data modelling",
        chapters: [
          [
            "Keep one promise together.",
            "A transaction groups changes that must agree.",
            "Either the complete group commits or none of it does.",
          ],
          [
            "Protect an invariant.",
            "A unique constraint can prevent duplicate ownership.",
            "A transaction can check and update related state atomically.",
          ],
          [
            "Choose locks deliberately.",
            "Lock the rows or admission decision that can conflict.",
            "Do not serialize unrelated work without a reason.",
          ],
          [
            "Keep remote work outside.",
            "Do not hold a transaction open while encoding a video.",
            "Persist the intent, commit, then let a worker continue.",
          ],
        ],
      },
    ],
  },
  {
    slug: "interface-studies",
    title: "Interface Studies",
    accent: "#f49cc4",
    shade: "#351d2e",
    motif: "grid",
    description:
      "Layout, feedback and everyday product details. An original PeerScreen showcase series.",
    videos: [
      {
        slug: "visual-hierarchy",
        title: "Make the important thing easy to find",
        tag: "Design",
        chapters: [
          [
            "Give the page one clear start.",
            "Use type size, spacing and contrast to establish priority.",
            "A heading should help a viewer choose their next action.",
          ],
          [
            "Group what belongs together.",
            "Related controls need less space between them.",
            "Use larger gaps to separate different tasks.",
          ],
          [
            "Let content do the work.",
            "A useful thumbnail and title beat a decorative slogan.",
            "Keep engineering detail in places where it helps a decision.",
          ],
          [
            "Check the smaller screen.",
            "A good desktop grid must still read clearly on a phone.",
            "Keep controls reachable without horizontal scrolling.",
          ],
        ],
      },
      {
        slug: "loading-states",
        title: "A loading state should tell you something",
        tag: "Frontend",
        chapters: [
          [
            "A request has several outcomes.",
            "Loading, success, empty and error are different states.",
            "Each deserves a useful response from the interface.",
          ],
          [
            "Preserve the shape.",
            "A skeleton can reserve the layout of expected content.",
            "Respect reduced-motion preferences.",
          ],
          [
            "Keep useful input.",
            "A failed upload should not erase its title and description.",
            "Offer a retry that preserves the user's intent.",
          ],
          [
            "Make progress truthful.",
            "An uploaded file may still be waiting for processing.",
            "Show the actual stage before enabling publication.",
          ],
        ],
      },
      {
        slug: "keyboard-player",
        title: "The small details of a custom player",
        tag: "Accessibility",
        chapters: [
          [
            "Give controls clear names.",
            "Play, Pause, Mute and quality need accessible labels.",
            "An icon alone is not a complete control.",
          ],
          [
            "Keep the keyboard useful.",
            "Use predictable play, seek and volume actions.",
            "Do not intercept typing inside an unrelated input.",
          ],
          [
            "Reveal controls when needed.",
            "Pointer movement and keyboard focus should expose actions.",
            "Paused playback should keep its controls available.",
          ],
          [
            "Check real browser behaviour.",
            "Fullscreen, autoplay and media decoding differ by browser.",
            "Verify the interaction rather than assuming support.",
          ],
        ],
      },
    ],
  },
  {
    slug: "network-notebook",
    title: "Network Notebook",
    accent: "#f4ca72",
    shade: "#34291b",
    motif: "nodes",
    description:
      "What happens between a click and a response. An original PeerScreen showcase series.",
    videos: [
      {
        slug: "https",
        title: "A secure connection starts with a name",
        tag: "Networking",
        chapters: [
          [
            "DNS finds a destination.",
            "The hostname resolves to an address serving the application.",
            "DNS itself does not encrypt the HTTP request.",
          ],
          [
            "TLS verifies the hostname.",
            "The server presents a certificate for the requested name.",
            "The browser checks its validity and trust chain.",
          ],
          [
            "Then HTTP carries the request.",
            "The encrypted connection transports headers and bodies.",
            "Secure cookies travel only over HTTPS.",
          ],
          [
            "A CDN is another delivery choice.",
            "A CDN can cache selected responses closer to viewers.",
            "It is not a prerequisite for a valid HTTPS application.",
          ],
        ],
      },
      {
        slug: "latency-throughput",
        title: "Fast requests and busy servers",
        tag: "Performance",
        chapters: [
          [
            "Latency follows one request.",
            "Measure from request start through the response body.",
            "State whether the number includes network time.",
          ],
          [
            "Throughput counts completed work.",
            "Measure successful requests over elapsed time.",
            "Record errors instead of counting every attempt as success.",
          ],
          [
            "Offer load deliberately.",
            "Fixed arrival rates keep offering work as responses slow.",
            "Dropped requests and longer queues reveal pressure.",
          ],
          [
            "Publish the conditions.",
            "State dataset size, hardware, duration and endpoint mix.",
            "A result without its workload is difficult to compare.",
          ],
        ],
      },
      {
        slug: "same-network",
        title: "Peer sharing across the room",
        tag: "WebRTC",
        chapters: [
          [
            "Two viewers can share a network.",
            "WebRTC can connect devices on the same local network.",
            "Both viewers must enable sharing for the same video version.",
          ],
          [
            "The tracker introduces peers.",
            "It carries signalling; it does not relay the video.",
            "The peers try the connection candidates they discover.",
          ],
          [
            "Local delivery can use less internet.",
            "A segment already downloaded by one viewer can be shared.",
            "Initial segments and unavailable pieces still use the server.",
          ],
          [
            "Network policy still matters.",
            "Guest Wi-Fi or client isolation can block local devices.",
            "HTTP playback remains available if the peer path fails.",
          ],
        ],
      },
    ],
  },
];
export const videos = series.flatMap((channel, c) =>
  channel.videos.map((video, i) => ({
    ...video,
    channel: channel.slug,
    sequence: c * 3 + i + 1,
  })),
);

# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React/Vite web client, Express API, TypeScript, SQLite. Chosen in the supplied implementation brief.

## Users

GRE learners working through Quant and Verbal material in short, repeatable study sessions. This is inferred from the supplied implementation brief.

## Product Purpose

A focused, keyboard-friendly study workspace for tracking video lessons and practicing GRE questions with immediate feedback.

## Positioning

Local course media and pre-generated, offline-readable catalogs make the study plan fast and dependable without conflating published course content with personal learning history.

## Operating Context

Learners alternate between course videos and practice questions on desktop and iPhone. Video playback requires a connection; catalog reading remains available offline after a first load.

## Capabilities and Constraints

- Username/password accounts only; no email or recovery flow.
- Published catalogs exclude source user data. Personal progress and attempts live in SQLite.
- Four independently cached compressed catalogs; media is streamed only.
- Local source material under `GRE Quant/` and `GRE Verbal/` is the import authority.

## Evidence on Hand

Local Quant and Verbal course JSON, question JSON, pairing data, and MP4 media are present in this repository.

## Product Principles

- Keep the next useful study action visible.
- Preserve fast, predictable keyboard operation.
- Be candid about offline and session limitations.
- Keep learner data private and separate from course content.

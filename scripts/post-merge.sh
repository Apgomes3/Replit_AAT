#!/bin/bash
set -e

npm install
npm run migrate
npm run species:catalog:seed

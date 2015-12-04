#!/bin/bash

# This program reads a stats CSV from stdin, generates a Markdown table
# from the CSV contents, and replaces the {stats_table} placeholder in the
# docs/running_ringpop.md.tmpl template with the Markdown table.
#
# This program expects the CSV to be formatted in the following way:
#
#   * The first row is a headers row
#   * The first three columns are: Node.js path, description, type
#
# Here is an excerpt of an actual CSV file to illustrate the above
# requirements:
#
#   Node.js Path,Description,Type
#   join.recv,Join request received,count
#   ping.recv,Ping request received,count
#   ping.send,Ping request sent,count

# Trim contents of stdin to requirements specified above.
lines=$(cat | tail -n +2 | cut -f1-3 -d,)

# Build the headers for the markdown table.
read -r -d '' markdown_table <<TABLE
|Node.js Path|Description|Type
|----|----|----
TABLE

# Keep for later restoration.
ifs_old=$IFS

# Transform rows in CSV to rows of Markdown table.
IFS=$'\n'
for line in $lines; do
    # Replace , with pipes to make contents markdown
    # compatible.
    markdown_row=$(echo $line | sed 's/,/|/g')
    markdown_row="|$markdown_row"
    markdown_table="$markdown_table\n$markdown_row"
done

# Restore IFS
IFS=$ifs_old

# Replace templatized .tmpl file with markdown table content
cat docs/running_ringpop.md.tmpl | awk -v markdown_table="${markdown_table//$'\n'/\\n}" '{sub("{stats_table}", markdown_table)}1' > docs/running_ringpop.md

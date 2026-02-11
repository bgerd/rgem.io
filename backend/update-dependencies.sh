# Handler and layer package.json files currently have no npm dependencies
# (AWS SDK v3 ships with the Node.js 20.x Lambda runtime).
# If dependencies are added in the future, update them here:
#
# for dir in onhello onping ontoggle schedhb ondisconnect gempost layers/common/nodejs; do
#   cd "$dir" && ncu -u && npm install && cd -
# done
